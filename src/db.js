import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'KDAtreats.db');

// Ensure the data directory exists before opening the database file.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    slug       TEXT NOT NULL UNIQUE,
    icon       TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    description  TEXT    NOT NULL DEFAULT '',
    price        INTEGER NOT NULL CHECK (price >= 0),
    category     TEXT    NOT NULL REFERENCES categories(slug) ON UPDATE CASCADE,
    image        TEXT,
    spice_level  INTEGER NOT NULL DEFAULT 0,
    is_available INTEGER NOT NULL DEFAULT 1,
    is_featured  INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name    TEXT NOT NULL,
    customer_address TEXT NOT NULL,
    customer_phone   TEXT,
    customer_email  TEXT,
    customer_note    TEXT,
    total_price      INTEGER NOT NULL CHECK (total_price >= 0),
    status           TEXT NOT NULL DEFAULT 'pending',
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    item_id    INTEGER,
    name       TEXT    NOT NULL,
    price      INTEGER NOT NULL CHECK (price >= 0),
    quantity   INTEGER NOT NULL CHECK (quantity > 0)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL,
    message    TEXT NOT NULL,
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category);
  CREATE INDEX IF NOT EXISTS idx_order_items_order    ON order_items(order_id);
`);

/**
 * Run `fn` inside a transaction. Rolls back and rethrows on error.
 * (node:sqlite has no built-in .transaction() wrapper like better-sqlite3.)
 */
export function transaction(fn) {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
}

/** Normalise a DB row into the camelCase shape the React client expects. */
const mapItem = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  price: row.price,
  category: row.category,
  image: row.image,
  spiceLevel: row.spice_level,
  isAvailable: !!row.is_available,
  isFeatured: !!row.is_featured,
});

export const getCategories = () =>
  db.prepare('SELECT * FROM categories ORDER BY sort_order ASC').all();

export const getMenuItems = () =>
  db.prepare('SELECT * FROM menu_items ORDER BY is_featured DESC, id ASC').all().map(mapItem);

export default db;