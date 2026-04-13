import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "data", "headroom.db");

// Lazy-init: SQLite only opens when actually used (not in cloud mode)
let _db = null;
function db() {
  if (!_db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    migrate();
  }
  return _db;
}

// --- Migrations ---

const MIGRATIONS = [
  // v1: boards, columns, cards, votes
  `
  CREATE TABLE boards (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    cycle_id TEXT NOT NULL,
    preset TEXT NOT NULL DEFAULT 'custom',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(team_id, cycle_id)
  );
  CREATE TABLE board_columns (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    color TEXT DEFAULT NULL
  );
  CREATE TABLE cards (
    id TEXT PRIMARY KEY,
    column_id TEXT NOT NULL REFERENCES board_columns(id) ON DELETE CASCADE,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    position REAL NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE votes (
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    voter_id TEXT NOT NULL,
    PRIMARY KEY (card_id, voter_id)
  );
  `,
  // v2: actual hours tracking
  `
  CREATE TABLE actual_hours (
    issue_id TEXT PRIMARY KEY,
    hours REAL NOT NULL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  `,
];

function migrate() {
  const d = db();
  d.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL DEFAULT 0)`);
  const row = d.prepare("SELECT version FROM schema_version").get();
  if (!row) d.prepare("INSERT INTO schema_version (version) VALUES (0)").run();
  const current = d.prepare("SELECT version FROM schema_version").get().version;
  for (let i = current; i < MIGRATIONS.length; i++) {
    d.exec(MIGRATIONS[i]);
  }
  if (current < MIGRATIONS.length) {
    d.prepare("UPDATE schema_version SET version = ?").run(MIGRATIONS.length);
  }
}

// --- Helpers ---

function uuid() {
  return crypto.randomUUID();
}

const PRESETS = {
  retrospective: [
    { title: "Went well", color: "#36b87a", position: 0 },
    { title: "To improve", color: "#e5a04b", position: 1 },
    { title: "Action items", color: "#5b7fff", position: 2 },
  ],
  planning: [
    { title: "To discuss", color: "#e5a04b", position: 0 },
    { title: "Ready", color: "#36b87a", position: 1 },
    { title: "Needs refinement", color: "#ef5a5a", position: 2 },
  ],
  custom: [
    { title: "Column 1", color: null, position: 0 },
  ],
};

// --- Board operations ---

let _stmts = null;
function stmts() {
  if (!_stmts) {
    const d = db();
    _stmts = {
      getBoard: d.prepare("SELECT * FROM boards WHERE team_id = ? AND cycle_id = ?"),
      getBoardById: d.prepare("SELECT * FROM boards WHERE id = ?"),
      insertBoard: d.prepare("INSERT INTO boards (id, team_id, cycle_id, preset) VALUES (?, ?, ?, ?)"),
      deleteBoard: d.prepare("DELETE FROM boards WHERE id = ?"),
      getColumns: d.prepare("SELECT * FROM board_columns WHERE board_id = ? ORDER BY position"),
      insertColumn: d.prepare("INSERT INTO board_columns (id, board_id, title, position, color) VALUES (?, ?, ?, ?, ?)"),
      updateColumn: d.prepare("UPDATE board_columns SET title = ?, position = ?, color = ? WHERE id = ?"),
      deleteColumn: d.prepare("DELETE FROM board_columns WHERE id = ?"),
      maxColumnPos: d.prepare("SELECT MAX(position) as maxPos FROM board_columns WHERE board_id = ?"),
      getCards: d.prepare("SELECT * FROM cards WHERE board_id = ? ORDER BY position"),
      getCardsByColumn: d.prepare("SELECT * FROM cards WHERE column_id = ? ORDER BY position"),
      insertCard: d.prepare("INSERT INTO cards (id, column_id, board_id, text, position) VALUES (?, ?, ?, ?, ?)"),
      updateCard: d.prepare("UPDATE cards SET text = ? WHERE id = ?"),
      moveCard: d.prepare("UPDATE cards SET column_id = ?, position = ? WHERE id = ?"),
      deleteCard: d.prepare("DELETE FROM cards WHERE id = ?"),
      getCard: d.prepare("SELECT * FROM cards WHERE id = ?"),
      maxCardPos: d.prepare("SELECT MAX(position) as maxPos FROM cards WHERE column_id = ?"),
      getVotesForCard: d.prepare("SELECT COUNT(*) as count FROM votes WHERE card_id = ?"),
      getVotesForBoard: d.prepare("SELECT card_id, COUNT(*) as count FROM votes WHERE card_id IN (SELECT id FROM cards WHERE board_id = ?) GROUP BY card_id"),
      getVoterVotes: d.prepare("SELECT card_id FROM votes WHERE voter_id = ? AND card_id IN (SELECT id FROM cards WHERE board_id = ?)"),
      insertVote: d.prepare("INSERT OR IGNORE INTO votes (card_id, voter_id) VALUES (?, ?)"),
      deleteVote: d.prepare("DELETE FROM votes WHERE card_id = ? AND voter_id = ?"),
      hasVote: d.prepare("SELECT 1 FROM votes WHERE card_id = ? AND voter_id = ?"),
    };
  }
  return _stmts;
}

// Shorthand for accessing prepared statements
function s() { return stmts(); }

export function getOrCreateBoard(teamId, cycleId, preset = "retrospective") {
  let board = s().getBoard.get(teamId, cycleId);
  if (!board) {
    const id = uuid();
    s().insertBoard.run(id, teamId, cycleId, preset);
    const cols = PRESETS[preset] || PRESETS.custom;
    for (const col of cols) {
      s().insertColumn.run(uuid(), id, col.title, col.position, col.color);
    }
    board = s().getBoardById.get(id);
  }
  return board;
}

export function getFullBoard(teamId, cycleId, voterId) {
  const board = getOrCreateBoard(teamId, cycleId);
  const columns = s().getColumns.all(board.id);
  const cards = s().getCards.all(board.id);
  const voteCounts = {};
  for (const v of s().getVotesForBoard.all(board.id)) {
    voteCounts[v.card_id] = v.count;
  }
  const myVotes = new Set();
  if (voterId) {
    for (const v of s().getVoterVotes.all(voterId, board.id)) {
      myVotes.add(v.card_id);
    }
  }

  return {
    id: board.id,
    preset: board.preset,
    columns: columns.map((col) => ({
      ...col,
      cards: cards
        .filter((c) => c.column_id === col.id)
        .map((c) => ({
          ...c,
          votes: voteCounts[c.id] || 0,
          myVote: myVotes.has(c.id),
        })),
    })),
  };
}

export function resetBoard(teamId, cycleId, preset) {
  const board = s().getBoard.get(teamId, cycleId);
  if (board) s().deleteBoard.run(board.id);
  return getOrCreateBoard(teamId, cycleId, preset);
}

export function addColumn(boardId, title, color = null) {
  const { maxPos } = s().maxColumnPos.get(boardId);
  const position = (maxPos ?? -1) + 1;
  const id = uuid();
  s().insertColumn.run(id, boardId, title, position, color);
  return { id, board_id: boardId, title, position, color };
}

export function updateColumn(columnId, title, position, color) {
  s().updateColumn.run(title, position, color, columnId);
  return { id: columnId, title, position, color };
}

export function deleteColumn(columnId) {
  s().deleteColumn.run(columnId);
}

export function addCard(columnId, boardId, text) {
  const { maxPos } = s().maxCardPos.get(columnId);
  const position = (maxPos ?? -1) + 1;
  const id = uuid();
  s().insertCard.run(id, columnId, boardId, text, position);
  return { id, column_id: columnId, board_id: boardId, text, position, votes: 0, myVote: false };
}

export function updateCard(cardId, text) {
  s().updateCard.run(text, cardId);
  return s().getCard.get(cardId);
}

export function moveCard(cardId, newColumnId, newPosition) {
  s().moveCard.run(newColumnId, newPosition, cardId);
  return s().getCard.get(cardId);
}

export function deleteCard(cardId) {
  s().deleteCard.run(cardId);
}

export function toggleVote(cardId, voterId) {
  const existing = s().hasVote.get(cardId, voterId);
  if (existing) {
    s().deleteVote.run(cardId, voterId);
  } else {
    s().insertVote.run(cardId, voterId);
  }
  const { count } = s().getVotesForCard.get(cardId);
  return { cardId, count, voted: !existing };
}

// --- Actual hours ---

let _ahStmts = null;
function ahStmts() {
  if (!_ahStmts) {
    const d = db();
    _ahStmts = {
      getMany: d.prepare("SELECT * FROM actual_hours WHERE issue_id IN (SELECT value FROM json_each(?))"),
      upsert: d.prepare(`
        INSERT INTO actual_hours (issue_id, hours, updated_at) VALUES (?, ?, datetime('now'))
        ON CONFLICT(issue_id) DO UPDATE SET hours = excluded.hours, updated_at = datetime('now')
      `),
    };
  }
  return _ahStmts;
}

export function getActualHours(issueIds) {
  const result = {};
  const rows = ahStmts().getMany.all(JSON.stringify(issueIds));
  rows.forEach((r) => { result[r.issue_id] = r.hours; });
  return result;
}

export function setActualHours(issueId, hours) {
  ahStmts().upsert.run(issueId, hours);
}

export { PRESETS };
export default db;
