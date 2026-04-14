import { useState, useEffect, useCallback, useRef } from "react";
import { io } from "socket.io-client";

function getVoterId() {
  let id = localStorage.getItem("boardVoterId");
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem("boardVoterId", id);
  }
  return id;
}

let _demoIdCounter = 1;
function demoId() { return `demo-${Date.now()}-${_demoIdCounter++}`; }

const PRESET_COLUMNS = {
  retrospective: [
    { title: "Went well", color: "#36b87a" },
    { title: "To improve", color: "#e8a820" },
    { title: "Action items", color: "#5b7fff" },
  ],
  planning: [
    { title: "To discuss", color: "#e8a820" },
    { title: "Ready", color: "#36b87a" },
    { title: "Needs refinement", color: "#ff4d4d" },
  ],
  custom: [
    { title: "Column 1", color: null },
    { title: "Column 2", color: null },
    { title: "Column 3", color: null },
  ],
};

export function useDemoBoard(teamId, cycleId) {
  const voterId = useRef(getVoterId()).current;
  const [board, setBoard] = useState(() => {
    const cols = PRESET_COLUMNS.retrospective.map((col, i) => ({
      id: demoId(), title: col.title, color: col.color, position: i, cards: [],
    }));
    return { id: demoId(), preset: "retrospective", columns: cols };
  });

  const emit = useCallback((event, data) => {
    setBoard((b) => {
      if (!b) return b;
      switch (event) {
        case "add-card": {
          const card = { id: demoId(), text: data.text, column_id: data.columnId, position: Date.now(), votes: 0, myVote: false };
          return { ...b, columns: b.columns.map((col) => col.id === data.columnId ? { ...col, cards: [...col.cards, card] } : col) };
        }
        case "update-card": {
          return { ...b, columns: b.columns.map((col) => ({ ...col, cards: col.cards.map((c) => c.id === data.cardId ? { ...c, text: data.text } : c) })) };
        }
        case "delete-card": {
          return { ...b, columns: b.columns.map((col) => ({ ...col, cards: col.cards.filter((c) => c.id !== data.cardId) })) };
        }
        case "move-card": {
          let movedCard = null;
          const without = b.columns.map((col) => {
            const found = col.cards.find((c) => c.id === data.cardId);
            if (found) movedCard = { ...found, column_id: data.newColumnId, position: data.newPosition };
            return { ...col, cards: col.cards.filter((c) => c.id !== data.cardId) };
          });
          if (!movedCard) return b;
          return { ...b, columns: without.map((col) => col.id === data.newColumnId ? { ...col, cards: [...col.cards, movedCard].sort((a, c) => a.position - c.position) } : col) };
        }
        case "toggle-vote": {
          return {
            ...b, columns: b.columns.map((col) => ({
              ...col, cards: col.cards.map((c) => {
                if (c.id !== data.cardId) return c;
                const newVote = !c.myVote;
                return { ...c, myVote: newVote, votes: newVote ? c.votes + 1 : Math.max(0, c.votes - 1) };
              }),
            })),
          };
        }
        case "add-column": {
          const col = { id: demoId(), title: data.title, color: data.color, position: b.columns.length, cards: [] };
          return { ...b, columns: [...b.columns, col] };
        }
        case "update-column": {
          return { ...b, columns: b.columns.map((c) => c.id === data.columnId ? { ...c, title: data.title, position: data.position, color: data.color } : c).sort((a, c) => a.position - c.position) };
        }
        case "delete-column": {
          return { ...b, columns: b.columns.filter((c) => c.id !== data.columnId) };
        }
        case "reset-board": {
          const cols = (PRESET_COLUMNS[data.preset] || PRESET_COLUMNS.custom).map((col, i) => ({
            id: demoId(), title: col.title, color: col.color, position: i, cards: [],
          }));
          return { ...b, preset: data.preset, columns: cols };
        }
        default:
          return b;
      }
    });
  }, []);

  return { board, connected: true, emit, voterId };
}

export function useBoardSocket(teamId, cycleId, userId = null) {
  const [board, setBoard] = useState(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  // Server derives voterId from session; we only need our own id to identify "myVote"
  const voterId = userId;

  useEffect(() => {
    if (!teamId || !cycleId) return;

    const socket = io({ transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("join-board", { teamId, cycleId });
      // Fetch full board state via REST (server uses session.userId as voterId)
      fetch(`/api/board/${teamId}/${cycleId}`)
        .then((r) => r.json())
        .then((data) => setBoard(data))
        .catch(console.error);
    });

    socket.on("disconnect", () => setConnected(false));

    socket.on("card-added", (card) => {
      setBoard((b) => {
        if (!b) return b;
        return {
          ...b,
          columns: b.columns.map((col) =>
            col.id === card.column_id
              ? { ...col, cards: [...col.cards, card] }
              : col
          ),
        };
      });
    });

    socket.on("card-updated", (card) => {
      setBoard((b) => {
        if (!b) return b;
        return {
          ...b,
          columns: b.columns.map((col) => ({
            ...col,
            cards: col.cards.map((c) => (c.id === card.id ? { ...c, text: card.text } : c)),
          })),
        };
      });
    });

    socket.on("card-moved", (card) => {
      setBoard((b) => {
        if (!b) return b;
        // Remove from old column, add to new
        let movedCard = null;
        const withoutCard = b.columns.map((col) => {
          const found = col.cards.find((c) => c.id === card.id);
          if (found) movedCard = { ...found, column_id: card.column_id, position: card.position };
          return { ...col, cards: col.cards.filter((c) => c.id !== card.id) };
        });
        if (!movedCard) return b;
        return {
          ...b,
          columns: withoutCard.map((col) =>
            col.id === card.column_id
              ? { ...col, cards: [...col.cards, movedCard].sort((a, c) => a.position - c.position) }
              : col
          ),
        };
      });
    });

    socket.on("card-deleted", ({ cardId }) => {
      setBoard((b) => {
        if (!b) return b;
        return {
          ...b,
          columns: b.columns.map((col) => ({
            ...col,
            cards: col.cards.filter((c) => c.id !== cardId),
          })),
        };
      });
    });

    socket.on("vote-updated", ({ cardId, count, voted, voterId: eventVoterId }) => {
      setBoard((b) => {
        if (!b) return b;
        return {
          ...b,
          columns: b.columns.map((col) => ({
            ...col,
            cards: col.cards.map((c) =>
              c.id === cardId
                ? { ...c, votes: count, myVote: eventVoterId === voterId ? voted : c.myVote }
                : c
            ),
          })),
        };
      });
    });

    socket.on("column-added", (col) => {
      setBoard((b) => {
        if (!b) return b;
        return { ...b, columns: [...b.columns, { ...col, cards: [] }] };
      });
    });

    socket.on("column-updated", (col) => {
      setBoard((b) => {
        if (!b) return b;
        return {
          ...b,
          columns: b.columns
            .map((c) => (c.id === col.id ? { ...c, title: col.title, position: col.position, color: col.color } : c))
            .sort((a, c) => a.position - c.position),
        };
      });
    });

    socket.on("column-deleted", ({ columnId }) => {
      setBoard((b) => {
        if (!b) return b;
        return { ...b, columns: b.columns.filter((c) => c.id !== columnId) };
      });
    });

    socket.on("board-reset", (newBoard) => {
      setBoard(newBoard);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [teamId, cycleId, voterId]);

  const emit = useCallback((event, data) => {
    socketRef.current?.emit(event, data);
  }, []);

  return { board, connected, emit, voterId };
}
