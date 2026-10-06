import { Router } from 'express';
import db, { getCategories, getMenuItems, mapItem } from '../db/index.js';

const router = Router();

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
router.patch('/menu/:id', async (req, res, next) => {
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

export default router;
