import { Router } from 'express';
import db, { getCategories, getMenuItems, mapItem } from '../db/index.js';
import { requireAdmin } from '../auth.js';

const router = Router();

/** Build a URL slug from a category name, e.g. "Small Chops" -> "small-chops". */
function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '') || 'category';
}

/** Ensure a slug is unique by suffixing -2, -3, ... until it is free. */
async function uniqueSlug(base) {
  let slug = base;
  let n = 2;
  while (await db.first('SELECT id FROM categories WHERE slug = ?', [slug])) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

async function categoryExists(slug) {
  return Boolean(await db.first('SELECT slug FROM categories WHERE slug = ?', [slug]));
}

/**
 * Merge an incoming payload over the existing row (when provided) and validate
 * the result. Works for both POST (new item) and PUT (full update).
 */
function parseItemPayload(body, existing = null) {
  const errors = [];
  const data = {
    name: body.name !== undefined ? String(body.name).trim() : existing?.name,
    description: body.description !== undefined ? String(body.description).trim() : existing?.description ?? '',
    price: body.price !== undefined ? Number(body.price) : existing?.price,
    category: body.category !== undefined ? String(body.category).trim() : existing?.category,
    image: body.image !== undefined ? String(body.image).trim() : existing?.image ?? null,
    spiceLevel: body.spiceLevel !== undefined ? Number(body.spiceLevel) : existing?.spiceLevel ?? 0,
    isAvailable: body.isAvailable !== undefined ? Boolean(body.isAvailable) : existing?.isAvailable ?? true,
    isFeatured: body.isFeatured !== undefined ? Boolean(body.isFeatured) : existing?.isFeatured ?? false,
  };

  if (!data.name) errors.push('name is required');
  if (!data.category) errors.push('category is required');
  if (data.price === undefined || data.price === null || Number.isNaN(data.price) || data.price < 0) {
    errors.push('price must be a non-negative number');
  }
  if (!Number.isInteger(data.spiceLevel) || data.spiceLevel < 0 || data.spiceLevel > 5) {
    errors.push('spiceLevel must be an integer between 0 and 5');
  }

  return { errors, data };
}

/** GET /api/menu — categories + items (supports ?category= and ?featured=) */
router.get('/menu', async (req, res, next) => {
  try {
    const { category, featured } = req.query;
    let items = await getMenuItems();

    if (category && category !== 'all') {
      items = items.filter((i) => i.category === category);
    }
    if (featured === 'true') {
      items = items.filter((i) => i.isFeatured);
    }

    res.json({ categories: await getCategories(), items });
  } catch (err) {
    next(err);
  }
});

/** GET /api/categories */
router.get('/categories', async (_req, res, next) => {
  try {
    res.json({ categories: await getCategories() });
  } catch (err) {
    next(err);
  }
});

/** GET /api/menu/:id */
router.get('/menu/:id', async (req, res, next) => {
  try {
    const row = await db.first('SELECT * FROM menu_items WHERE id = ?', [Number(req.params.id)]);
    if (!row) return res.status(404).json({ error: 'Menu item not found' });
    res.json({ item: mapItem(row) });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/menu/:id — update price / availability / featured (admin) */
router.patch('/menu/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await db.first('SELECT * FROM menu_items WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Menu item not found' });

    const { isAvailable, isFeatured, price } = req.body ?? {};

    if (price !== undefined && (typeof price !== 'number' || price < 0 || Number.isNaN(price))) {
      return res.status(400).json({ error: 'price must be a non-negative number' });
    }

    // COALESCE keeps the existing value when a field is omitted.
    await db.run(
      `UPDATE menu_items SET
         is_available = COALESCE(?, is_available),
         is_featured  = COALESCE(?, is_featured),
         price        = COALESCE(?, price)
       WHERE id = ?`,
      [
        isAvailable === undefined ? null : Boolean(isAvailable),
        isFeatured === undefined ? null : Boolean(isFeatured),
        price === undefined ? null : price,
        id,
      ],
    );

    const updated = await db.first('SELECT * FROM menu_items WHERE id = ?', [id]);
    res.json({ item: mapItem(updated) });
  } catch (err) {
    next(err);
  }
});

/** POST /api/menu — create a menu item (admin) */
router.post('/menu', requireAdmin, async (req, res, next) => {
  try {
    const { errors, data } = parseItemPayload(req.body ?? {});
    if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });
    if (!(await categoryExists(data.category))) {
      return res.status(400).json({ error: `Unknown category: "${data.category}"` });
    }

    const { lastInsertRowid } = await db.run(
      `INSERT INTO menu_items
        (name, description, price, category, image, spice_level, is_available, is_featured)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.name,
        data.description,
        data.price,
        data.category,
        data.image,
        data.spiceLevel,
        data.isAvailable,
        data.isFeatured,
      ],
    );

    const row = await db.first('SELECT * FROM menu_items WHERE id = ?', [lastInsertRowid]);
    res.status(201).json({ item: mapItem(row) });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/menu/:id — full update of a menu item (admin) */
router.put('/menu/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await db.first('SELECT * FROM menu_items WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Menu item not found' });

    const { errors, data } = parseItemPayload(req.body ?? {}, mapItem(existing));
    if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });
    if (!(await categoryExists(data.category))) {
      return res.status(400).json({ error: `Unknown category: "${data.category}"` });
    }

    await db.run(
      `UPDATE menu_items SET
         name = ?, description = ?, price = ?, category = ?, image = ?,
         spice_level = ?, is_available = ?, is_featured = ?
       WHERE id = ?`,
      [
        data.name,
        data.description,
        data.price,
        data.category,
        data.image,
        data.spiceLevel,
        data.isAvailable,
        data.isFeatured,
        id,
      ],
    );

    const updated = await db.first('SELECT * FROM menu_items WHERE id = ?', [id]);
    res.json({ item: mapItem(updated) });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/menu/:id — remove a menu item (admin) */
router.delete('/menu/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const result = await db.run('DELETE FROM menu_items WHERE id = ?', [id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Menu item not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** POST /api/categories — create a category (admin) */
router.post('/categories', requireAdmin, async (req, res, next) => {
  try {
    const { name, icon, sortOrder, slug: providedSlug } = req.body ?? {};
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

    const slug = providedSlug?.trim() ? slugify(providedSlug) : slugify(name);
    const finalSlug = await uniqueSlug(slug);

    await db.run(
      'INSERT INTO categories (id, name, slug, icon, sort_order) VALUES (?, ?, ?, ?, ?)',
      [finalSlug, name.trim(), finalSlug, icon?.trim() || null, Number(sortOrder) || 0],
    );

    const row = await db.first('SELECT * FROM categories WHERE slug = ?', [finalSlug]);
    res.status(201).json({
      category: { id: row.id, name: row.name, slug: row.slug, icon: row.icon, sortOrder: Number(row.sort_order) },
    });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/categories/:id — update a category (admin) */
router.put('/categories/:id', requireAdmin, async (req, res, next) => {
  try {
    const raw = String(req.params.id);
    const existing = await db.first('SELECT * FROM categories WHERE id = ? OR slug = ?', [raw, raw]);
    if (!existing) return res.status(404).json({ error: 'Category not found' });

    const name = req.body?.name?.trim() ?? existing.name;
    const slug = req.body?.slug?.trim() ? slugify(req.body.slug) : existing.slug;
    const icon = req.body?.icon?.trim() || existing.icon || null;
    const sortOrder = req.body?.sortOrder !== undefined ? Number(req.body.sortOrder) : Number(existing.sort_order);

    if (!name) return res.status(400).json({ error: 'name cannot be empty' });
    if (!slug) return res.status(400).json({ error: 'slug cannot be empty' });

    const conflict = slug !== existing.slug
      ? await db.first('SELECT * FROM categories WHERE slug = ? AND id <> ?', [slug, existing.id])
      : null;
    if (conflict) return res.status(409).json({ error: `Category "${slug}" already exists` });

    // Rename both PK and slug so they stay aligned; the FK on
    // menu_items(category) references categories(slug) with ON UPDATE CASCADE,
    // so dependent items are re-pointed automatically.
    await db.run(
      'UPDATE categories SET id = ?, name = ?, slug = ?, icon = ?, sort_order = ? WHERE id = ?',
      [slug, name, slug, icon, sortOrder, existing.id],
    );

    const row = await db.first('SELECT * FROM categories WHERE id = ?', [slug]);
    res.json({
      category: { id: row.id, name: row.name, slug: row.slug, icon: row.icon, sortOrder: Number(row.sort_order) },
    });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/categories/:id — delete a category (admin) */
router.delete('/categories/:id', requireAdmin, async (req, res, next) => {
  try {
    const raw = String(req.params.id);
    const existing = await db.first('SELECT * FROM categories WHERE id = ? OR slug = ?', [raw, raw]);
    if (!existing) return res.status(404).json({ error: 'Category not found' });

    const used = await db.first('SELECT COUNT(*) AS c FROM menu_items WHERE category = ?', [existing.slug]);
    if (Number(used.c) > 0) {
      return res.status(409).json({
        error: `Cannot delete "${existing.name}" — ${used.c} menu item(s) still use this category`,
      });
    }

    await db.run('DELETE FROM categories WHERE id = ?', [existing.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
