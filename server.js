import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import {
  getFullBoard, resetBoard, addColumn, updateColumn, deleteColumn,
  addCard, updateCard, moveCard, deleteCard, toggleVote,
  getActualHours, setActualHours,
} from "./db.js";
import { LinearCache } from "./linear-cache.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(options = {}) {
  const {
    linearApiKey = process.env.LINEAR_API_KEY,
    getApiKeyForRequest = null,
    onLinearAuthError = null,
    beforeRoutes = null,
    afterRoutes = null,
    dataDir = path.join(__dirname, "data"),
    serveFrontend = true,
    // Cloud mode skips built-in board/availability/actual-hours routes and socket handlers
    // (it mounts tenant-aware versions itself)
    skipBoardRoutes = false,
    skipSocketHandlers = false,
    // Linear webhook HMAC secret (optional; if set, webhooks without matching signature are rejected)
    linearWebhookSecret = process.env.LINEAR_WEBHOOK_SECRET || null,
    // Called when a verified Linear webhook arrives; returns tenant info for cache invalidation and room scoping
    onLinearWebhook = null,
  } = options;

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);

  // Ensure data directory exists
  fs.mkdirSync(dataDir, { recursive: true });

  // Input validation helpers
  const isValidId = (s) => typeof s === "string" && s.length > 0 && s.length <= 200;
  const MAX_BODY_FIELDS = { text: 10000, title: 500, color: 50, preset: 50 };

  // Hook for cloud to add auth/billing middleware before routes
  if (beforeRoutes) {
    beforeRoutes(app);
  }

  // Proxy /api/linear -> api.linear.app/graphql
  app.post("/api/linear", express.json({ limit: "100kb" }), async (req, res) => {
    try {
      if (!req.body?.query || typeof req.body.query !== "string") {
        return res.status(400).json({ error: "Missing GraphQL query" });
      }

      // Resolve API key: per-request function takes priority, then static key
      let apiKey = null;
      if (getApiKeyForRequest) {
        apiKey = await getApiKeyForRequest(req);
      } else {
        apiKey = linearApiKey;
      }

      if (!apiKey) {
        return res.status(401).json({ error: "No Linear API key available" });
      }

      const body = JSON.stringify(req.body);

      const makeRequest = (key) => fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: key },
        body,
      });

      let response = await makeRequest(apiKey);

      // If 401 and we have a refresh hook, try refreshing the token and retry once
      if (response.status === 401 && onLinearAuthError) {
        const newKey = await onLinearAuthError(req);
        if (newKey) {
          response = await makeRequest(newKey);
        }
      }

      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json(data);
      }

      res.json(data);
    } catch (err) {
      console.error("Linear API error:", err.message);
      res.status(502).json({ error: "Failed to reach Linear API", detail: err.message });
    }
  });

  // --- Cached data layer ---
  // Helper to fetch from Linear with the right API key
  const linearFetch = async (query, variables, req) => {
    let apiKey = null;
    if (getApiKeyForRequest && req) {
      apiKey = await getApiKeyForRequest(req);
    } else {
      apiKey = linearApiKey;
    }
    if (!apiKey) throw new Error("No Linear API key");

    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: apiKey },
      body: JSON.stringify({ query, variables }),
    });
    const data = await response.json();
    if (!response.ok || data.errors) {
      throw new Error(data.errors?.[0]?.message || `Linear API ${response.status}`);
    }
    return data.data;
  };

  // Per-request cache (standalone uses one global cache, cloud creates per-tenant)
  const globalCache = linearApiKey
    ? new LinearCache({ fetchFromLinear: (q, v) => linearFetch(q, v, null) })
    : null;

  function getCache(req) {
    // Cloud mode: cache is stored on the session (or we use global with request context)
    if (getApiKeyForRequest) {
      // For cloud, we create a cache that uses the request's API key
      // We use a simple approach: one global cache but fetch always uses the request's key
      if (!globalCache) {
        // Lazy init — cloud mode doesn't have a static key
        return new LinearCache({
          fetchFromLinear: (q, v) => linearFetch(q, v, req),
          ttl: 5 * 60 * 1000,
        });
      }
    }
    return globalCache;
  }

  // Cached data endpoints
  app.get("/api/data/teams", async (req, res) => {
    try {
      const cache = getCache(req);
      if (!cache) return res.status(503).json({ error: "No cache available" });
      const data = await cache.getTeams();
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.get("/api/data/team/:teamId", async (req, res) => {
    try {
      const cache = getCache(req);
      if (!cache) return res.status(503).json({ error: "No cache available" });
      const data = await cache.getTeamData(req.params.teamId);
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.get("/api/data/cycle/:cycleId/issues", async (req, res) => {
    try {
      const cache = getCache(req);
      if (!cache) return res.status(503).json({ error: "No cache available" });
      const data = await cache.getCycleIssues(req.params.cycleId);
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.get("/api/data/team/:teamId/backlog", async (req, res) => {
    try {
      const cache = getCache(req);
      if (!cache) return res.status(503).json({ error: "No cache available" });
      const data = await cache.getBacklogIssues(req.params.teamId);
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.get("/api/data/projects", async (req, res) => {
    try {
      const cache = getCache(req);
      if (!cache) return res.status(503).json({ error: "No cache available" });
      const data = await cache.getProjects();
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.get("/api/data/project/:projectId/issues", async (req, res) => {
    try {
      const cache = getCache(req);
      if (!cache) return res.status(503).json({ error: "No cache available" });
      const data = await cache.getProjectIssues(req.params.projectId);
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.post("/api/data/refresh", express.json(), async (req, res) => {
    try {
      const cache = getCache(req);
      if (!cache) return res.status(503).json({ error: "No cache available" });
      cache.invalidateAll();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Linear webhook ---
  // Use raw body so we can verify the HMAC signature
  app.post("/api/webhooks/linear", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
    // Verify signature if secret is configured
    if (linearWebhookSecret) {
      const signature = req.headers["linear-signature"];
      if (!signature) {
        return res.status(401).json({ error: "Missing signature" });
      }
      const crypto = await import("crypto");
      const expected = crypto.createHmac("sha256", linearWebhookSecret).update(req.body).digest("hex");
      if (signature !== expected) {
        return res.status(401).json({ error: "Invalid signature" });
      }
    }

    let payload;
    try {
      payload = JSON.parse(req.body.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }

    const { action, type, data: eventData } = payload;

    // Respond quickly — Linear expects 200 within seconds
    res.json({ ok: true });

    // Cloud mode: let the cloud handler resolve tenant and scope invalidation/emit
    if (onLinearWebhook) {
      try {
        await onLinearWebhook({ action, type, eventData, payload, io });
      } catch (err) {
        console.error("Linear webhook handler error:", err.message);
      }
      return;
    }

    // Standalone mode: invalidate global cache + emit to all clients
    if (globalCache) {
      const teamId = eventData?.teamId || eventData?.team?.id;
      if (type === "Issue" || type === "Comment") {
        globalCache.invalidateIssues(teamId);
      } else if (type === "Cycle") {
        globalCache.invalidateTeam(teamId);
      } else if (type === "Project" || type === "ProjectMilestone") {
        globalCache.invalidateProjects();
      } else {
        globalCache.invalidateAll();
      }
    }
    io.emit("data-updated", { type, action });
  });

  // Wire cache change events to Socket.io
  if (globalCache) {
    globalCache.onChange((event, payload) => {
      io.emit("data-updated", { event, ...payload });
    });
  }

  // Availability API (disabled in cloud mode — cloud mounts tenant-aware versions)
  if (!skipBoardRoutes) {
  function availabilityPath(teamId, cycleId) {
    const safe = (s) => s.replace(/[^a-zA-Z0-9_-]/g, "");
    return path.join(dataDir, `availability_${safe(teamId)}_${safe(cycleId)}.json`);
  }

  app.get("/api/availability/:teamId/:cycleId", (req, res) => {
    const file = availabilityPath(req.params.teamId, req.params.cycleId);
    try {
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        res.json(data);
      } else {
        res.json({ pointsPerDay: 2, people: {} });
      }
    } catch {
      res.json({ pointsPerDay: 2, people: {} });
    }
  });

  app.put("/api/availability/:teamId/:cycleId", express.json({ limit: "50kb" }), (req, res) => {
    if (!isValidId(req.params.teamId) || !isValidId(req.params.cycleId)) {
      return res.status(400).json({ error: "Invalid teamId or cycleId" });
    }
    if (!req.body || typeof req.body !== "object") {
      return res.status(400).json({ error: "Invalid body" });
    }
    const file = availabilityPath(req.params.teamId, req.params.cycleId);
    try {
      fs.writeFileSync(file, JSON.stringify(req.body, null, 2));
      res.json({ ok: true });
    } catch (err) {
      console.error("Failed to save availability:", err.message);
      res.status(500).json({ error: "Failed to save" });
    }
  });

  // Board REST endpoint (initial load)
  app.get("/api/board/:teamId/:cycleId", (req, res) => {
    try {
      const voterId = req.query.voterId || null;
      const board = getFullBoard(req.params.teamId, req.params.cycleId, voterId);
      res.json(board);
    } catch (err) {
      console.error("Board error:", err.message);
      res.status(500).json({ error: "Failed to load board" });
    }
  });

  // Actual hours API
  app.post("/api/actual-hours", express.json(), (req, res) => {
    try {
      const { issueIds } = req.body;
      if (!Array.isArray(issueIds)) {
        return res.status(400).json({ error: "issueIds must be an array" });
      }
      const hours = getActualHours(issueIds);
      res.json(hours);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch hours" });
    }
  });

  app.put("/api/actual-hours/:issueId", express.json(), (req, res) => {
    try {
      if (!isValidId(req.params.issueId)) {
        return res.status(400).json({ error: "Invalid issueId" });
      }
      const hours = parseFloat(req.body.hours);
      if (isNaN(hours) || hours < 0 || hours > 10000) {
        return res.status(400).json({ error: "Invalid hours value" });
      }
      setActualHours(req.params.issueId, hours);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to save hours" });
    }
  });
  } // end skipBoardRoutes

  // Board socket.io (disabled in cloud mode — cloud mounts tenant-aware versions)
  if (!skipSocketHandlers) {
  io.on("connection", (socket) => {
    let currentRoom = null;

    socket.on("join-board", ({ teamId, cycleId, voterId }) => {
      if (currentRoom) socket.leave(currentRoom);
      currentRoom = `board:${teamId}:${cycleId}`;
      socket.join(currentRoom);
      socket.teamId = teamId;
      socket.cycleId = cycleId;
      socket.voterId = voterId;
    });

    socket.on("add-card", ({ columnId, boardId, text }) => {
      try {
        const card = addCard(columnId, boardId, text);
        io.to(currentRoom).emit("card-added", card);
      } catch (err) {
        socket.emit("error", { message: err.message });
      }
    });

    socket.on("update-card", ({ cardId, text }) => {
      try {
        const card = updateCard(cardId, text);
        io.to(currentRoom).emit("card-updated", card);
      } catch (err) {
        socket.emit("error", { message: err.message });
      }
    });

    socket.on("move-card", ({ cardId, newColumnId, newPosition }) => {
      try {
        const card = moveCard(cardId, newColumnId, newPosition);
        io.to(currentRoom).emit("card-moved", card);
      } catch (err) {
        socket.emit("error", { message: err.message });
      }
    });

    socket.on("delete-card", ({ cardId }) => {
      try {
        deleteCard(cardId);
        io.to(currentRoom).emit("card-deleted", { cardId });
      } catch (err) {
        socket.emit("error", { message: err.message });
      }
    });

    socket.on("toggle-vote", ({ cardId, voterId }) => {
      try {
        const result = toggleVote(cardId, voterId);
        io.to(currentRoom).emit("vote-updated", { ...result, voterId });
      } catch (err) {
        socket.emit("error", { message: err.message });
      }
    });

    socket.on("add-column", ({ boardId, title, color }) => {
      try {
        const col = addColumn(boardId, title, color);
        io.to(currentRoom).emit("column-added", col);
      } catch (err) {
        socket.emit("error", { message: err.message });
      }
    });

    socket.on("update-column", ({ columnId, title, position, color }) => {
      try {
        const col = updateColumn(columnId, title, position, color);
        io.to(currentRoom).emit("column-updated", col);
      } catch (err) {
        socket.emit("error", { message: err.message });
      }
    });

    socket.on("delete-column", ({ columnId }) => {
      try {
        deleteColumn(columnId);
        io.to(currentRoom).emit("column-deleted", { columnId });
      } catch (err) {
        socket.emit("error", { message: err.message });
      }
    });

    socket.on("reset-board", ({ teamId, cycleId, preset }) => {
      try {
        resetBoard(teamId, cycleId, preset);
        const board = getFullBoard(teamId, cycleId, socket.voterId);
        io.to(currentRoom).emit("board-reset", board);
      } catch (err) {
        socket.emit("error", { message: err.message });
      }
    });
  });
  } // end skipSocketHandlers

  // Hook for cloud to register its own routes and socket handlers
  if (afterRoutes) {
    afterRoutes({ app, io });
  }

  // Serve frontend (standalone mode)
  if (serveFrontend) {
    app.use(express.static(path.join(__dirname, "frontend", "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "frontend", "dist", "index.html"));
    });
  }

  // Global error handler — don't leak internals to client
  app.use((err, req, res, _next) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  });

  return { app, server, io };
}

// Standalone mode: run directly with `node server.js`
const isDirectRun = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
  if (!LINEAR_API_KEY) {
    console.error("LINEAR_API_KEY environment variable is required");
    console.error("Get one from: Linear > Settings > Account > Security & Access > API");
    process.exit(1);
  }

  const PORT = process.env.PORT || 3000;
  const { server } = createApp({ linearApiKey: LINEAR_API_KEY });

  server.listen(PORT, () => {
    console.log(`Capacycle running on http://localhost:${PORT}`);
  });
}
