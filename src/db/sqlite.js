/**
 * SQLite driver (local development / offline fallback).
 * Uses Node's built-in `node:sqlite` — no native compilation required.
 *
 * Exposes the same async interface as the Postgres driver so routes never
 * need to know which database is in use.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function createSqliteDriver(connectionString) {
  // connectionString is a filesystem path for SQLite.
  const file = connectionString && connectionString !== ':memory:'
    ? connectionString
    : path.join(process.cwd(), 'data', 'KDAtreats.db');

  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL;');
  raw.exec('PRAGMA foreign_keys = ON;');

  // node:sqlite rejects JS booleans as bind values; store them as 0/1.
  const bind = (params = []) =>
    params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p === undefined ? null : p));

  return {
    dialect: 'sqlite',

    async all(sql, params) {
      return raw.prepare(sql).all(...bind(params));
    },

    async first(sql, params) {
      return raw.prepare(sql).get(...bind(params));
    },

    async run(sql, params) {
      const result = raw.prepare(sql).run(...bind(params));
      return {
        changes: Number(result.changes),
        lastInsertRowid: Number(result.lastInsertRowid),
      };
    },

    async exec(sql) {
      raw.exec(sql);
    },

    async transaction(fn) {
      raw.exec('BEGIN');
      try {
        const result = await fn(this);
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },

    async close() {
      raw.close();
    },
  };
}