/**
 * PostgreSQL driver (production — Neon / Supabase / Render Postgres).
 *
 * Exposes the same async interface as the SQLite driver. Routes are written
 * against `?` placeholders; this driver rewrites them to Postgres `$n` form so
 * the same SQL string works on both engines.
 */
import pg from 'pg';

const { Pool, types } = pg;

/**
 * Postgres returns NUMERIC as a string to avoid precision loss.
 * All money/quantity columns in this schema are safe integers, so parse them.
 */
types.setTypeParser(types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
types.setTypeParser(types.builtins.INT8, (v) => (v === null ? null : Number(v)));

/** Rewrite `?` placeholders to `$1, $2, ...`, ignoring those inside quotes. */
function toPgPlaceholders(sql) {
  let index = 0;
  let inSingle = false;
  let result = '';

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (ch === "'") {
      // Toggle quote state unless escaped by doubling ('').
      if (inSingle && sql[i + 1] === "'") {
        result += "''";
        i++;
        continue;
      }
      inSingle = !inSingle;
      result += ch;
      continue;
    }

    if (ch === '?' && !inSingle) {
      index += 1;
      result += `$${index}`;
      continue;
    }

    result += ch;
  }

  return result;
}

export function createPostgresDriver(connectionString) {
  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('sslmode=disable')
      ? false
      : { rejectUnauthorized: false },
    max: Number(process.env.DB_POOL_MAX) || 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // A pool-level error (e.g. an idle client dropped by the provider) must not
  // crash the process — log it and let pg reconnect on the next query.
  pool.on('error', (err) => {
    console.error('Unexpected postgres pool error:', err.message);
  });

  const run = async (fn) => fn(pool);

  return {
    dialect: 'postgres',
    pool,

    async all(sql, params) {
      const { rows } = await run((p) => p.query(toPgPlaceholders(sql), params));
      return rows;
    },

    async first(sql, params) {
      const { rows } = await run((p) => p.query(toPgPlaceholders(sql), params));
      return rows[0];
    },

    async run(sql, params) {
      const text = toPgPlaceholders(sql);
      const result = await run((p) => p.query(text, params));
      return {
        changes: result.rowCount ?? 0,
        lastInsertRowid: result.rows[0]?.id ?? null,
      };
    },

    /** Postgres has no equivalent to SQLite's multi-statement exec. */
    async exec(sql) {
      await run((p) => p.query(sql));
    },

    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Wrap the client in the same interface so transaction callbacks work.
        const tx = {
          dialect: 'postgres',
          async all(q, params) {
            const { rows } = await client.query(toPgPlaceholders(q), params);
            return rows;
          },
          async first(q, params) {
            const { rows } = await client.query(toPgPlaceholders(q), params);
            return rows[0];
          },
          async run(q, params) {
            const res = await client.query(toPgPlaceholders(q), params);
            return { changes: res.rowCount ?? 0, lastInsertRowid: res.rows[0]?.id ?? null };
          },
          async exec(q) {
            await client.query(q);
          },
        };

        const result = await fn(tx);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async close() {
      await pool.end();
    },
  };
}