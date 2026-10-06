import { Router } from 'express';
import db, { transaction } from '../db/index.js';
import { requireAdmin } from '../auth.js';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_STATUSES = [
  'pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled',
];

function validateOrder(body) {
  const errors = [];
  const { customerName, customerAddress, customerEmail, customerPhone, customerNote, items } = body ?? {};

  if (!customerName?.trim()) errors.push('customerName is required');
  if (!customerAddress?.trim()) errors.push('customerAddress is required');
  if (customerEmail && !EMAIL_RE.test(customerEmail)) errors.push('customerEmail is invalid');
  if (!Array.isArray(items) || items.length === 0) errors.push('items must be a non-empty array');

  const cleanItems = (Array.isArray(items) ? items : []).map((i) => ({
    itemId: i.itemId !== undefined ? Number(i.itemId) : null,
    name: typeof i.name === 'string' ? i.name.trim() : '',
    quantity: Number(i.quantity),
  }));

  for (const [idx, item] of cleanItems.entries()) {
    if (!item.itemId || Number.isNaN(item.itemId)) errors.push(`items[${idx}].itemId is required`);
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      errors.push(`items[${idx}].quantity must be a positive integer`);
    }
    if (item.quantity > 100) errors.push(`items[${idx}].quantity exceeds maximum of 100`);
  }

  return { errors, cleanItems };
}

/** POST /api/orders — create an order. Prices are recomputed from the DB. */
router.post('/orders', async (req, res, next) => {
  try {
    const { customerName, customerAddress, customerEmail, customerPhone, customerNote } = req.body ?? {};
    const { errors, cleanItems } = validateOrder(req.body);

    if (errors.length) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    // Resolve real prices from the database — never trust client-supplied totals.
    const lines = [];
    for (const item of cleanItems) {
      const row = await db.first('SELECT id, name, price, is_available FROM menu_items WHERE id = ?', [item.itemId]);
      if (!row) {
        return res.status(400).json({ error: `Unknown menu item: ${item.itemId}` });
      }
      if (Number(row.is_available) !== 1) {
        return res.status(409).json({ error: `"${row.name}" is currently unavailable` });
      }
      lines.push({ itemId: row.id, name: row.name, price: Number(row.price), quantity: item.quantity });
    }

    const totalPrice = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);

    const orderId = await transaction(async (tx) => {
      const { lastInsertRowid } = await tx.run(
        `INSERT INTO orders
          (customer_name, customer_address, customer_phone, customer_email, customer_note, total_price)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          customerName.trim(),
          customerAddress.trim(),
          customerPhone?.trim() || null,
          customerEmail?.trim() || null,
          customerNote?.trim() || null,
          totalPrice,
        ],
      );

      for (const l of lines) {
        await tx.run(
          'INSERT INTO order_items (order_id, item_id, name, price, quantity) VALUES (?, ?, ?, ?, ?)',
          [lastInsertRowid, l.itemId, l.name, l.price, l.quantity],
        );
      }

      return lastInsertRowid;
    });

    res.status(201).json({
      order: { id: orderId, status: 'pending', totalPrice, items: lines },
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/orders — list orders (admin), supports ?status= and ?limit= */
router.get('/orders', requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const { status } = req.query;

    const rows = status && ALLOWED_STATUSES.includes(status)
      ? await db.all('SELECT * FROM orders WHERE status = ? ORDER BY id DESC LIMIT ?', [status, limit])
      : await db.all('SELECT * FROM orders ORDER BY id DESC LIMIT ?', [limit]);

    res.json({
      orders: rows.map((o) => ({
        id: o.id,
        customerName: o.customer_name,
        customerAddress: o.customer_address,
        customerPhone: o.customer_phone,
        customerEmail: o.customer_email,
        customerNote: o.customer_note,
        totalPrice: Number(o.total_price),
        status: o.status,
        createdAt: o.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/orders/:id */
router.get('/orders/:id', requireAdmin, async (req, res, next) => {
  try {
    const order = await db.first('SELECT * FROM orders WHERE id = ?', [Number(req.params.id)]);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const items = await db.all(
      'SELECT name, price, quantity FROM order_items WHERE order_id = ?',
      [order.id],
    );

    res.json({
      order: {
        id: order.id,
        customerName: order.customer_name,
        customerAddress: order.customer_address,
        customerPhone: order.customer_phone,
        customerEmail: order.customer_email,
        customerNote: order.customer_note,
        totalPrice: Number(order.total_price),
        status: order.status,
        createdAt: order.created_at,
        items: items.map((i) => ({ name: i.name, price: Number(i.price), quantity: Number(i.quantity) })),
      },
    });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/orders/:id/status — advance an order's status (admin) */
router.patch('/orders/:id/status', requireAdmin, async (req, res, next) => {
  try {
    const { status } = req.body ?? {};

    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${ALLOWED_STATUSES.join(', ')}` });
    }

    const result = await db.run(
      'UPDATE orders SET status = ? WHERE id = ?',
      [status, Number(req.params.id)],
    );
    if (result.changes === 0) return res.status(404).json({ error: 'Order not found' });

    res.json({ order: { id: Number(req.params.id), status } });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/orders/:id — remove an order (admin). Order items cascade. */
router.delete('/orders/:id', requireAdmin, async (req, res, next) => {
  try {
    const result = await db.run('DELETE FROM orders WHERE id = ?', [Number(req.params.id)]);
    if (result.changes === 0) return res.status(404).json({ error: 'Order not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;