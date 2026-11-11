import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export const DB_PATH = resolve(process.env.DB_PATH || 'data/crm.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, title TEXT, color TEXT
);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, position REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT, position REAL NOT NULL DEFAULT 0,
  columns TEXT NOT NULL DEFAULT '[]',
  subitem_columns TEXT NOT NULL DEFAULT '[]',
  views TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  title TEXT NOT NULL, color TEXT NOT NULL, position REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES items(id) ON DELETE CASCADE,
  name TEXT NOT NULL, position REAL NOT NULL DEFAULT 0,
  vals TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  created_by TEXT, updated_by TEXT
);
CREATE INDEX IF NOT EXISTS items_board ON items(board_id);
CREATE TABLE IF NOT EXISTS updates (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  board_id TEXT NOT NULL,
  user_id TEXT, user_name TEXT, body TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS updates_item ON updates(item_id);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id TEXT NOT NULL, item_id TEXT, item_name TEXT, user_id TEXT,
  kind TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_board ON activity(board_id, id);
CREATE INDEX IF NOT EXISTS activity_item ON activity(item_id, id);
`);

export const newId = (prefix = '') => prefix + randomBytes(8).toString('hex');
export const now = () => new Date().toISOString();

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
