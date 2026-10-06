/**
 * Seeds the database from the menu seed data so the API and UI stay in sync.
 *
 * The client's copy (client/src/data/menu.js) is preferred whenever the full
 * monorepo is checked out (local development). When the server ships on its
 * own — e.g. a Render service with root directory `server`, where files
 * outside the service root don't exist — the bundled copy
 * (server/src/data/menu.js) is used instead.
 *
 * Safe to run repeatedly: only an empty database is populated, so admin
 * edits to prices/availability are never overwritten on restart.
 * Pass { force: true } to deliberately rebuild the catalogue.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import db, { transaction } from './db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Candidate locations for the seed data module, in preference order:
//  1. The client's copy — the source of truth in a full monorepo checkout.
//  2. The bundled copy — used when the server is deployed without the
//     client/ directory (e.g. Render root directory = `server`).
const MENU_CANDIDATES = [
  path.resolve(__dirname, '..', '..', 'client', 'src', 'data', 'menu.js'),
  path.resolve(__dirname, 'data', 'menu.js'),
];

const MENU_MODULE = MENU_CANDIDATES.find((candidate) => fs.existsSync(candidate));

export async function seed({ silent = false, force = false } = {}) {
  if (!MENU_MODULE) {
    throw new Error(
      `Menu seed data not found. Looked in:\n  ${MENU_CANDIDATES.join('\n  ')}`,
    );
  }
  const { categories, menuItems } = await import(pathToFileURL(MENU_MODULE).href);

  const upsertCategory = async (c) => {
    await db.run(
      `INSERT INTO categories (id, name, slug, icon, sort_order)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, slug = excluded.slug,
         icon = excluded.icon, sort_order = excluded.sort_order`,
      [c.id, c.name, c.slug, c.icon ?? null, c.sortOrder ?? 0],
    );
  };

  const count = await db.first('SELECT COUNT(*) AS c FROM menu_items');

  // Only populate an empty database. Re-seeding on every boot would wipe
  // admin edits (prices, availability) and drift the auto-increment IDs.
  if (Number(count?.c ?? 0) > 0 && !force) {
    if (!silent) console.log(`Database already has ${count.c} menu items — skipping seed.`);
    return;
  }

  await transaction(async (tx) => {
    for (const c of categories) {
      await upsertCategory(c);
    }
    await tx.run('DELETE FROM menu_items');
    for (const item of menuItems) {
      await tx.run(
        `INSERT INTO menu_items (name, description, price, category, image, spice_level, is_available, is_featured)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.name,
          item.description ?? '',
          item.price,
          item.category,
          item.image ?? null,
          item.spiceLevel ?? 0,
          item.isAvailable ? 1 : 0,
          item.isFeatured ? 1 : 0,
        ],
      );
    }
  });

  if (!silent) {
    console.log(`Seeded ${categories.length} categories and ${menuItems.length} menu items.`);
  }
}

// Allow running directly: `npm run seed`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seed({ force: process.argv.includes('--force') }).catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}