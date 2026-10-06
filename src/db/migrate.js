/**
 * Schema migrations.
 *
 * Written in plain SQL per dialect because the two engines differ in types
 * (AUTOINCREMENT vs SERIAL, INTEGER flags vs BOOLEAN) and in their IF NOT
 * EXISTS support. Every statement is idempotent, so this runs safely on every
 * boot.
 */

const SQLITE_SCHEMA = `
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
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name     TEXT    NOT NULL,
    customer_address  TEXT    NOT NULL,
    customer_phone    TEXT,
    customer_email    TEXT,
    customer_note     TEXT,
    total_price       INTEGER NOT NULL CHECK (total_price >= 0),
    status            TEXT    NOT NULL DEFAULT 'pending',
    created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
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
    name       TEXT    NOT NULL,
    email      TEXT    NOT NULL,
    message    TEXT    NOT NULL,
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category);
  CREATE INDEX IF NOT EXISTS idx_order_items_order    ON order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status        ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_messages_created     ON messages(created_at DESC);
`;

const POSTGRES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS categories (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    slug       TEXT NOT NULL UNIQUE,
    icon       TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id           SERIAL PRIMARY KEY,
    name         TEXT    NOT NULL,
    description  TEXT    NOT NULL DEFAULT '',
    price        INTEGER NOT NULL CHECK (price >= 0),
    category     TEXT    NOT NULL REFERENCES categories(slug) ON UPDATE CASCADE,
    image        TEXT,
    spice_level  INTEGER NOT NULL DEFAULT 0,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    is_featured  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS orders (
    id               SERIAL PRIMARY KEY,
    customer_name    TEXT    NOT NULL,
    customer_address TEXT    NOT NULL,
    customer_phone   TEXT,
    customer_email   TEXT,
    customer_note    TEXT,
    total_price      INTEGER NOT NULL CHECK (total_price >= 0),
    status           TEXT    NOT NULL DEFAULT 'pending',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id         SERIAL PRIMARY KEY,
    order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    item_id    INTEGER,
    name       TEXT    NOT NULL,
    price      INTEGER NOT NULL CHECK (price >= 0),
    quantity   INTEGER NOT NULL CHECK (quantity > 0)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL,
    message    TEXT NOT NULL,
    is_read    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category);
  CREATE INDEX IF NOT EXISTS idx_order_items_order    ON order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status        ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_messages_created     ON messages(created_at DESC);
`;

export async function runMigrations(driver) {
  const schema = driver.dialect === 'postgres' ? POSTGRES_SCHEMA : SQLITE_SCHEMA;

  // Postgres `pg` allows multiple statements in one simple query.
  await driver.exec(schema);
}