import { Router } from 'express';
import db, { transaction } from '../db/index.js';

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
router.post('/orders', (req, res) => {
  const { customerName, customerAddress, customerEmail, customerPhone, customerNote } = req.body ?? {};
  const { errors, cleanItems } = validateOrder(req.body);

  if (errors.length) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  const lookup = db.prepare('SELECT id, name, price, is_available FROM menu_items WHERE id = ?');

  // Resolve real prices from the database — never trust client-supplied totals.
  const lines = [];
  for (const item of cleanItems) {
    const row = lookup.get(item.itemId);
    if (!row) {
      return res.status(400).json({ error: `Unknown menu item: ${item.itemId}` });
    }
    if (!row.is_available) {
      return res.status(409).json({ error: `"${row.name}" is currently unavailable` });
    }
    lines.push({ itemId: row.id, name: row.name, price: row.price, quantity: item.quantity });
  }

  const totalPrice = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);

  const createOrder = transaction(() => {
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO orders
        (customer_name, customer_address, customer_phone, customer_email, customer_note, total_price)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      customerName.trim(),
      customerAddress.trim(),
      customerPhone?.trim() || null,
      customerEmail?.trim() || null,
      customerNote?.trim() || null,
      totalPrice,
    );

    const insertLine = db.prepare(`
      INSERT INTO order_items (order_id, item_id, name, price, quantity)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const l of lines) {
      insertLine.run(lastInsertRowid, l.itemId, l.name, l.price, l.quantity);
    }

    return lastInsertRowid;
  });

  const orderId = createOrder();

  res.status(201).json({
    order: { id: orderId, status: 'pending', totalPrice, items: lines },
  });
});

/** GET /api/orders — list recent orders (admin) */
router.get('/orders', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const orders = db
    .prepare('SELECT * FROM orders ORDER BY id DESC LIMIT ?')
    .all(limit)
    .map((o) => ({
      id: o.id,
      customerName: o.customer_name,
      customerAddress: o.customer_address,
      customerPhone: o.customer_phone,
      customerEmail: o.customer_email,
      customerNote: o.customer_note,
      totalPrice: o.total_price,
      status: o.status,
      createdAt: o.created_at,
    }));

  res.json({ orders });
});

/** GET /api/orders/:id */
router.get('/orders/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const items = db
    .prepare('SELECT name, price, quantity FROM order_items WHERE order_id = ?')
    .all(order.id);

  res.json({
    order: {
      id: order.id,
      customerName: order.customer_name,
      customerAddress: order.customer_address,
      customerPhone: order.customer_phone,
      customerEmail: order.customer_email,
      customerNote: order.customer_note,
      totalPrice: order.total_price,
      status: order.status,
      createdAt: order.created_at,
      items,
    },
  });
});

/** PATCH /api/orders/:id/status */
router.patch('/orders/:id/status', (req, res) => {
  const ALLOWED = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
  const { status } = req.body ?? {};

  if (!ALLOWED.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${ALLOWED.join(', ')}` });
  }

  const result = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, Number(req.params.id));
  if (result.changes === 0) return res.status(404).json({ error: 'Order not found' });

  res.json({ order: { id: Number(req.params.id), status } });
});

export default router;