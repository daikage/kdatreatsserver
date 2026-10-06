import { Router } from 'express';
import db from '../db/index.js';
import { requireAdmin, signAdminToken, verifyPasscode } from '../auth.js';

const router = Router();

/**
 * POST /api/admin/login — exchange the passcode for a session token.
 * Public on purpose: this is the only way to obtain an admin token.
 */
router.post('/admin/login', (req, res) => {
  const { passcode } = req.body ?? {};

  if (!verifyPasscode(passcode)) {
    return res.status(401).json({ error: 'Incorrect passcode' });
  }

  res.json({ token: signAdminToken() });
});

// Everything below this point is admin-only.
router.use('/admin', requireAdmin);

const DAY_START = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

/**
 * GET /api/admin/stats — dashboard metrics for the admin panel.
 *
 * Returns revenue + order totals, counts, status breakdown, the last 7 days
 * of sales, recent orders and the bestselling items. All aggregations are
 * written in plain SQL / JS so they run identically on SQLite and Postgres.
 */
router.get('/admin/stats', async (req, res, next) => {
  try {
    const today = DAY_START();

    const [
      totals,
      todayRow,
      menuCount,
      categoryCount,
      messageCount,
      unread,
      statuses,
      recentRows,
      popularRows,
    ] = await Promise.all([
      db.first(
        `SELECT COUNT(*) AS orders, COALESCE(SUM(total_price), 0) AS revenue
           FROM orders
          WHERE status <> 'cancelled'`,
      ),
      db.first(
        `SELECT COUNT(*) AS orders, COALESCE(SUM(total_price), 0) AS revenue
           FROM orders
          WHERE status <> 'cancelled' AND created_at >= ?`,
        [today],
      ),
      db.first('SELECT COUNT(*) AS c FROM menu_items'),
      db.first('SELECT COUNT(*) AS c FROM categories'),
      db.first('SELECT COUNT(*) AS c FROM messages'),
      db.first('SELECT COUNT(*) AS c FROM messages WHERE is_read = 0'),
      db.all('SELECT status, COUNT(*) AS count FROM orders GROUP BY status'),
      db.all(
        `SELECT id, customer_name, total_price, status, created_at
           FROM orders ORDER BY id DESC LIMIT 6`,
      ),
      db.all(
        `SELECT oi.name, SUM(oi.quantity) AS quantity, SUM(oi.price * oi.quantity) AS revenue
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
          WHERE o.status <> 'cancelled'
          GROUP BY oi.name
          ORDER BY quantity DESC
          LIMIT 5`,
      ),
    ]);

    // Bucket the last 7 days in JS so we can fill empty days with zeros and
    // stay agnostic of each DB's date functions.
    const days = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      days.push({ date: d.toISOString().slice(0, 10), revenue: 0, orders: 0 });
    }

    const weekRows = await db.all(
      `SELECT total_price, created_at FROM orders
        WHERE status <> 'cancelled' AND created_at >= ?
        ORDER BY id ASC`,
      [days[0].date],
    );
    for (const row of weekRows) {
      const key = String(row.created_at).slice(0, 10);
      const day = days.find((d) => d.date === key);
      if (day) {
        day.revenue += Number(row.total_price);
        day.orders += 1;
      }
    }

    const statusBreakdown = {
      pending: 0,
      confirmed: 0,
      preparing: 0,
      out_for_delivery: 0,
      delivered: 0,
      cancelled: 0,
    };
    for (const s of statuses) {
      if (s.status in statusBreakdown) statusBreakdown[s.status] = Number(s.count);
    }

    res.json({
      stats: {
        totalRevenue: Number(totals.revenue),
        totalOrders: Number(totals.orders),
        todayRevenue: Number(todayRow.revenue),
        todayOrders: Number(todayRow.orders),
        menuItemCount: Number(menuCount.c),
        categoryCount: Number(categoryCount.c),
        messageCount: Number(messageCount.c),
        unreadMessages: Number(unread.c),
        statusBreakdown,
        recentOrders: recentRows.map((o) => ({
          id: o.id,
          customerName: o.customer_name,
          totalPrice: Number(o.total_price),
          status: o.status,
          createdAt: o.created_at,
        })),
        popularItems: popularRows.map((p) => ({
          name: p.name,
          quantity: Number(p.quantity),
          revenue: Number(p.revenue),
        })),
        dailySales: days,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;