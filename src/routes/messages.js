import { Router } from 'express';
import db from '../db/index.js';
import { requireAdmin } from '../auth.js';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** POST /api/messages — contact form submission */
router.post('/messages', async (req, res, next) => {
  try {
    const { name, email, message } = req.body ?? {};
    const errors = [];

    if (!name?.trim()) errors.push('name is required');
    if (!email?.trim()) errors.push('email is required');
    else if (!EMAIL_RE.test(email.trim())) errors.push('email is invalid');
    if (!message?.trim()) errors.push('message is required');
    else if (message.trim().length > 2000) errors.push('message must be under 2000 characters');

    if (errors.length) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    const { lastInsertRowid } = await db.run(
      'INSERT INTO messages (name, email, message) VALUES (?, ?, ?)',
      [name.trim(), email.trim(), message.trim()],
    );

    res.status(201).json({ message: { id: lastInsertRowid, received: true } });
  } catch (err) {
    next(err);
  }
});

/** GET /api/messages — list contact messages (admin) */
router.get('/messages', requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await db.all('SELECT * FROM messages ORDER BY id DESC LIMIT ?', [limit]);

    res.json({
      messages: rows.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        message: m.message,
        isRead: m.is_read === true || m.is_read === 1,
        createdAt: m.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/messages/:id/read — mark a message read or unread */
router.patch('/messages/:id/read', requireAdmin, async (req, res, next) => {
  try {
    const isRead = req.body?.isRead === false ? 0 : 1;
    const result = await db.run(
      'UPDATE messages SET is_read = ? WHERE id = ?',
      [isRead, Number(req.params.id)],
    );

    if (result.changes === 0) return res.status(404).json({ error: 'Message not found' });

    res.json({ message: { id: Number(req.params.id), isRead: isRead === 1 } });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/messages/:id — remove a message (admin) */
router.delete('/messages/:id', requireAdmin, async (req, res, next) => {
  try {
    const result = await db.run('DELETE FROM messages WHERE id = ?', [Number(req.params.id)]);
    if (result.changes === 0) return res.status(404).json({ error: 'Message not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;