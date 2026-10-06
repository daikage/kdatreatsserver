import { Router } from 'express';
import db from '../db.js';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** POST /api/messages — contact form submission */
router.post('/messages', (req, res) => {
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

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO messages (name, email, message) VALUES (?, ?, ?)
  `).run(name.trim(), email.trim(), message.trim());

  res.status(201).json({ message: { id: lastInsertRowid, received: true } });
});

/** GET /api/messages — list contact messages (admin) */
router.get('/messages', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const messages = db
    .prepare('SELECT * FROM messages ORDER BY id DESC LIMIT ?')
    .all(limit)
    .map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      message: m.message,
      isRead: !!m.is_read,
      createdAt: m.created_at,
    }));

  res.json({ messages });
});

/** PATCH /api/messages/:id/read */
router.patch('/messages/:id/read', (req, res) => {
  const isRead = req.body?.isRead === false ? 0 : 1;
  const result = db
    .prepare('UPDATE messages SET is_read = ? WHERE id = ?')
    .run(isRead, Number(req.params.id));

  if (result.changes === 0) return res.status(404).json({ error: 'Message not found' });

  res.json({ message: { id: Number(req.params.id), isRead: !!isRead } });
});

export default router;