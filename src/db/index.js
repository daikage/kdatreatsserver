/**
 * Database entry point.
 *
 * Picks a driver from the environment:
 *   - `DATABASE_URL` starting with postgres:// or postgresql://  -> Postgres
 *   - otherwise                                                -> local SQLite
 *
 * Both drivers expose the same async interface:
 *   all(sql, params) / first(sql, params) / run(sql, params) /
 *   exec(sql) / transaction(fn) / close()
 * so the rest of the app is completely database-agnostic.
 */
import path from 'node:path';
import { createSqliteDriver } from './sqlite.js';
import { createPostgresDriver } from './postgres.js';
import { runMigrations } from './migrate.js';

export function createDriver() {
  const url = process.env.DATABASE_URL?.trim();

  if (url && /^postgres(ql)?:\/\//i.test(url)) {
    console.log('DB: PostgreSQL');
    return createPostgresDriver(url);
  }

  const file = process.env.SQLITE_PATH
    || path.join(process.cwd(), 'data', 'KDAtreats.db');
  console.log(`DB: SQLite (${file})`);
  return createSqliteDriver(file);
}

export const db = createDriver();

// Schema is created on boot so a fresh Postgres project works immediately.
await runMigrations(db);

/**
 * Run `fn` inside a transaction.
 * The callback receives the transaction handle, which should be used for all
 * queries inside the transaction.
 */
export function transaction(fn) {
  return db.transaction(fn);
}

/** Normalise a DB row into the camelCase shape the React client expects. */
export const mapItem = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  price: Number(row.price),
  category: row.category,
  image: row.image,
  spiceLevel: Number(row.spice_level),
  isAvailable: row.is_available === true || row.is_available === 1,
  isFeatured: row.is_featured === true || row.is_featured === 1,
});

export const getCategories = async () => {
  const rows = await db.all('SELECT * FROM categories ORDER BY sort_order ASC');
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    icon: r.icon,
    sortOrder: Number(r.sort_order),
  }));
};

export const getMenuItems = async () => {
  const rows = await db.all(
    'SELECT * FROM menu_items ORDER BY is_featured DESC, id ASC',
  );
  return rows.map(mapItem);
};

export default db;