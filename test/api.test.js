/**
 * End-to-end API smoke test. Starts the server on a test port,
 * exercises every endpoint, and exits non-zero on any failure.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.TEST_PORT || 4999;
const BASE = `http://127.0.0.1:${PORT}/api`;

let passed = 0;
let failed = 0;

function check(name, condition, extra = '') {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

async function api(method, endpoint, body) {
  const res = await fetch(`${BASE}${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data };
}

const server = spawn(process.execPath, ['src/index.js'], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});

// Wait for the server to come up.
let ready = false;
for (let i = 0; i < 40; i++) {
  try {
    const res = await fetch(`${BASE}/health`);
    if (res.ok) { ready = true; break; }
  } catch { /* retry */ }
  await new Promise((r) => setTimeout(r, 250));
}

if (!ready) {
  console.error('Server failed to start');
  server.kill();
  process.exit(1);
}

const TESTS = [];

const test = (group, name, fn) => TESTS.push({ group, name, fn });

// ── Health ───────────────────────────────────────────────────────────
test('Health', 'GET /api/health returns ok', async () => {
  const r = await api('GET', '/health');
  return [r.status === 200 && r.data?.status === 'ok', r.status];
});

// ── Menu ─────────────────────────────────────────────────────────────
test('Menu', 'GET /api/menu returns categories + items', async () => {
  const r = await api('GET', '/menu');
  return [Array.isArray(r.data?.categories) && Array.isArray(r.data?.items), r.status];
});

test('Menu', 'Menu has 16 items', async () => {
  const r = await api('GET', '/menu');
  return [r.data?.items?.length === 16, `got ${r.data?.items?.length}`];
});

test('Menu', 'Items use camelCase (spiceLevel/isAvailable)', async () => {
  const r = await api('GET', '/menu');
  const i = r.data?.items?.[0];
  return [i?.spiceLevel !== undefined && i?.isAvailable !== undefined, 'missing fields'];
});

test('Menu', 'GET /api/menu?category=grills filters correctly', async () => {
  const r = await api('GET', '/menu?category=grills');
  return [r.status === 200 && r.data.items.every((i) => i.category === 'grills'), `got ${r.data?.items?.length}`];
});

test('Menu', 'GET /api/menu?featured=true returns only featured', async () => {
  const r = await api('GET', '/menu?featured=true');
  return [r.status === 200 && r.data.items.every((i) => i.isFeatured), 'unfeatured leaked'];
});

test('Menu', 'GET /api/menu/:id returns an item', async () => {
  const r = await api('GET', '/menu/1');
  return [r.status === 200 && r.data?.item?.id === 1, r.status];
});

test('Menu', 'GET /api/menu/:id returns 404 for unknown id', async () => {
  const r = await api('GET', '/menu/99999');
  return [r.status === 404, r.status];
});

// ── Orders ───────────────────────────────────────────────────────────
let sampleId, samplePrice, orderId;

test('Orders', 'POST /api/orders rejects invalid payload with 400', async () => {
  const r = await api('POST', '/orders', { customerName: '', items: [] });
  return [r.status === 400, r.status];
});

test('Orders', 'POST /api/orders rejects quantity < 1', async () => {
  const r = await api('POST', '/orders', {
    customerName: 'Ada', customerAddress: 'Lekki',
    items: [{ itemId: 1, quantity: 0 }],
  });
  return [r.status === 400, r.status];
});

test('Orders', 'POST /api/orders rejects unknown menu item', async () => {
  const r = await api('POST', '/orders', {
    customerName: 'Ada', customerAddress: 'Lekki',
    items: [{ itemId: 99999, quantity: 1 }],
  });
  return [r.status === 400, r.status];
});

test('Orders', 'POST /api/orders creates an order', async () => {
  const menu = await api('GET', '/menu');
  sampleId = menu.data.items[0].id;
  samplePrice = menu.data.items[0].price;

  const r = await api('POST', '/orders', {
    customerName: 'Ada Obi',
    customerAddress: '12 Lekki Phase 1, Lagos',
    customerPhone: '+2348000000000',
    customerEmail: 'ada@example.com',
    customerNote: 'Extra pepper please',
    // Deliberately fake the price to prove the server ignores it.
    items: [{ itemId: sampleId, quantity: 2, price: 1 }],
  });
  orderId = r.data?.order?.id;
  return [r.status === 201, `status ${r.status}`];
});

test('Orders', 'Server recomputes total from DB price (ignores client price)', async () => {
  const r = await api('GET', `/orders/${orderId}`);
  return [r.data?.order?.totalPrice === samplePrice * 2,
    `expected ${samplePrice * 2}, got ${r.data?.order?.totalPrice}`];
});

test('Orders', 'GET /api/orders/:id returns order with items', async () => {
  const r = await api('GET', `/orders/${orderId}`);
  return [r.status === 200 && r.data?.order?.items?.length === 1, r.status];
});

test('Orders', 'GET /api/orders lists orders', async () => {
  const r = await api('GET', '/orders');
  return [r.status === 200 && r.data?.orders?.length >= 1, `got ${r.data?.orders?.length}`];
});

test('Orders', 'PATCH /api/orders/:id/status updates status', async () => {
  const r = await api('PATCH', `/orders/${orderId}/status`, { status: 'confirmed' });
  return [r.status === 200 && r.data?.order?.status === 'confirmed', r.status];
});

test('Orders', 'PATCH rejects an invalid status', async () => {
  const r = await api('PATCH', `/orders/${orderId}/status`, { status: 'teleported' });
  return [r.status === 400, r.status];
});

// ── Messages ─────────────────────────────────────────────────────────
test('Messages', 'POST /api/messages rejects invalid payload', async () => {
  const r = await api('POST', '/messages', { name: '', email: 'not-an-email', message: '' });
  return [r.status === 400, r.status];
});

test('Messages', 'POST /api/messages stores a message', async () => {
  const r = await api('POST', '/messages', {
    name: 'Chioma', email: 'chioma@example.com', message: 'Do you cater weddings?',
  });
  return [r.status === 201, `status ${r.status}`];
});

test('Messages', 'GET /api/messages lists messages', async () => {
  const r = await api('GET', '/messages');
  return [r.status === 200 && r.data?.messages?.length >= 1, `got ${r.data?.messages?.length}`];
});

// ── Errors ───────────────────────────────────────────────────────────
test('Errors', 'Unknown /api route returns JSON 404', async () => {
  const r = await api('GET', '/does-not-exist');
  return [r.status === 404 && !!r.data?.error, r.status];
});

try {
  let currentGroup = '';
  for (const { group, name, fn } of TESTS) {
    if (group !== currentGroup) {
      console.log(`\n--- ${group} ---`);
      currentGroup = group;
    }
    const [ok, extra] = await fn();
    check(name, ok, extra ? `(${extra})` : '');
  }
} finally {
  server.kill();
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);