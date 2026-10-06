/**
 * Seeds the SQLite database from the client's seed data
 * (client/src/data/menu.js) so the API and UI stay in sync.
 * Safe to run repeatedly: only an empty database is populated, so admin
 * edits to prices/availability are never overwritten on restart.
 * Pass { force: true } to deliberately rebuild the catalogue.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import db, { transaction } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MENU_MODULE = path.resolve(__dirname, '..', '..', 'client', 'src', 'data', 'menu.js');

export async function seed({ silent = false, force = false } = {}) {
  const { categories, menuItems } = await import(pathToFileURL(MENU_MODULE).href);

  const upsertCategory = db.prepare(`
    INSERT INTO categories (id, name, slug, icon, sort_order)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, slug = excluded.slug,
      icon = excluded.icon, sort_order = excluded.sort_order
  `);

  const insertItem = db.prepare(`
    INSERT INTO menu_items (name, description, price, category, image, spice_level, is_available, is_featured)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const count = db.prepare('SELECT COUNT(*) AS c FROM menu_items').get().c;

  // Only populate an empty database. Re-seeding on every boot would wipe
  // admin edits (prices, availability) and drift the auto-increment IDs.
  if (count > 0 && !force) {
    if (!silent) console.log(`Database already has ${count} menu items — skipping seed.`);
    return;
  }

  const run = transaction(() => {
    for (const c of categories) {
      upsertCategory.run(c.id, c.name, c.slug, c.icon, c.sortOrder);
    }
    db.prepare('DELETE FROM menu_items').run();
    for (const item of menuItems) {
      insertItem.run(
        item.name,
        item.description,
        item.price,
        item.category,
        item.image,
        item.spiceLevel ?? 0,
        item.isAvailable ? 1 : 0,
        item.isFeatured ? 1 : 0,
      );
    }
  });

  run();

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