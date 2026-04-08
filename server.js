import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const LINEAR_API_KEY = process.env.LINEAR_API_KEY;

if (!LINEAR_API_KEY) {
  console.error("LINEAR_API_KEY environment variable is required");
  console.error("Get one from: Linear > Settings > Account > Security & Access > API");
  process.exit(1);
}

// Proxy /api/linear -> api.linear.app/graphql
app.post("/api/linear", express.json(), async (req, res) => {
  try {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: LINEAR_API_KEY,
      },
      body: JSON.stringify(req.body),
    });

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

// Serve frontend
app.use(express.static(path.join(__dirname, "frontend", "dist")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Headroom running on http://localhost:${PORT}`);
});
