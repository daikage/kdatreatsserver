import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import menuRoutes from './routes/menu.js';
import orderRoutes from './routes/orders.js';
import messageRoutes from './routes/messages.js';
import adminRoutes from './routes/admin.js';
import { seed } from './seed.js';

const PORT = Number(process.env.PORT) || 4000;

// Always seed an empty database so a fresh clone runs without a manual step.
await seed({ silent: true });

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: '100kb' }));

// Request logger
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
});

/** Health check */
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.use('/api', menuRoutes);
app.use('/api', orderRoutes);
app.use('/api', messageRoutes);
app.use('/api', adminRoutes);

/** 404 for unmatched /api routes */
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Central error handler
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`KDA Treats API listening on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});