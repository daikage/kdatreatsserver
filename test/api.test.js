/**
 * End-to-end API smoke test. Starts the server on a test port,
 * exercises every endpoint, and exits non-zero on any failure.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.TEST_PORT || 4999;
const BASE = `http://127.0.0.1:${PORT}/api`;

// Run every test against a fresh, isolated database so test data never
// leaks between runs or into the developer's local KDAtreats.db.
const TEST_DB = path.join(os.tmpdir(), `KDAtreats-api-test-${process.pid}.db`);
for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(`${TEST_DB}${suffix}`, { force: true });
}

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

let authToken = null;

async function api(method, endpoint, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(`${BASE}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data };
}

const server = spawn(process.execPath, ['src/index.js'], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    PORT: String(PORT),
    ADMIN_PASSCODE: 'test-passcode',
    SQLITE_PATH: TEST_DB,
  },
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

// ── Admin: Auth ──────────────────────────────────────────────────────
test('Admin', 'admin endpoints are denied without a token', async () => {
  const r = await api('GET', '/admin/stats');
  return [r.status === 401, r.status];
});

test('Admin', 'POST /api/admin/login rejects a wrong passcode', async () => {
  const r = await api('POST', '/admin/login', { passcode: 'wrong-passcode' });
  return [r.status === 401, r.status];
});

test('Admin', 'POST /api/admin/login returns a token for the right passcode', async () => {
  const r = await api('POST', '/admin/login', { passcode: 'test-passcode' });
  authToken = r.data?.token;
  return [r.status === 200 && typeof authToken === 'string' && authToken.length > 10, r.status];
});

test('Admin', 'admin stats succeed with a valid token', async () => {
  const r = await api('GET', '/admin/stats');
  return [r.status === 200 && !!r.data?.stats, r.status];
});

// ── Orders ───────────────────────────────────────────────────────────
let sampleId, samplePrice, orderId, testItemId;

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

// ── Admin: Category & Menu CRUD ─────────────────────────────────────
test('Admin', 'POST /api/categories creates a category', async () => {
  const r = await api('POST', '/categories', { name: 'Test Category', icon: '🧪', sortOrder: 99 });
  return [r.status === 201 && r.data?.category?.slug === 'test-category', r.status];
});

test('Admin', 'POST /api/categories auto-uniquifies duplicate slugs', async () => {
  const r = await api('POST', '/categories', { name: 'Test Category' });
  return [r.status === 201 && r.data?.category?.slug === 'test-category-2', `got ${r.data?.category?.slug}`];
});

test('Admin', 'PUT /api/categories/:id updates name + slug', async () => {
  const r = await api('PUT', '/categories/test-category', {
    name: 'Updated Category',
    slug: 'updated-category',
  });
  return [
    r.status === 200
    && r.data?.category?.name === 'Updated Category'
    && r.data?.category?.slug === 'updated-category',
    r.status,
  ];
});

test('Admin', 'POST /api/menu creates an item in a category', async () => {
  const r = await api('POST', '/menu', {
    name: 'Test Snack',
    price: 900,
    category: 'updated-category',
  });
  testItemId = r.data?.item?.id;
  return [r.status === 201 && r.data?.item?.name === 'Test Snack', r.status];
});

test('Admin', 'DELETE /api/categories/:id is rejected while items use it', async () => {
  const r = await api('DELETE', '/categories/updated-category');
  return [r.status === 409, r.status];
});

test('Admin', 'PUT /api/menu/:id updates the item', async () => {
  const r = await api('PUT', `/menu/${testItemId}`, {
    name: 'Test Snack Supreme',
    price: 1100,
    category: 'updated-category',
    spiceLevel: 2,
  });
  return [
    r.status === 200
    && r.data?.item?.price === 1100
    && r.data?.item?.spiceLevel === 2,
    r.status,
  ];
});

test('Admin', 'DELETE /api/menu/:id removes the item', async () => {
  const r = await api('DELETE', `/menu/${testItemId}`);
  return [r.status === 200, r.status];
});

test('Admin', 'DELETE /api/categories/:id removes an empty category', async () => {
  const r = await api('DELETE', '/categories/updated-category');
  const r2 = await api('DELETE', '/categories/test-category-2');
  return [r.status === 200 && r2.status === 200, `main ${r.status}, uniquified ${r2.status}`];
});

test('Menu', 'Menu still has 16 items after admin CRUD', async () => {
  const r = await api('GET', '/menu');
  return [r.data?.items?.length === 16, `got ${r.data?.items?.length}`];
});

// ── Admin: Stats ────────────────────────────────────────────────────
test('Admin', 'GET /api/admin/stats returns dashboard metrics', async () => {
  const r = await api('GET', '/admin/stats');
  const s = r.data?.stats;
  return [
    r.status === 200
    && typeof s?.totalRevenue === 'number'
    && typeof s?.totalOrders === 'number'
    && typeof s?.todayRevenue === 'number'
    && typeof s?.unreadMessages === 'number'
    && s?.statusBreakdown && typeof s.statusBreakdown.pending === 'number'
    && Array.isArray(s?.dailySales) && s.dailySales.length === 7
    && Array.isArray(s?.recentOrders)
    && Array.isArray(s?.popularItems),
    `status ${r.status}`,
  ];
});

// ── Admin: Orders & Messages cleanup ────────────────────────────────
test('Admin', 'DELETE /api/orders/:id removes an order', async () => {
  const created = await api('POST', '/orders', {
    customerName: 'Cleanup', customerAddress: 'Lekki',
    items: [{ itemId: sampleId, quantity: 1 }],
  });
  const id = created.data?.order?.id;
  const del = await api('DELETE', `/orders/${id}`);
  const gone = await api('GET', `/orders/${id}`);
  return [del.status === 200 && gone.status === 404, `del ${del.status}, gone ${gone.status}`];
});

test('Admin', 'GET /api/orders?status= filters results', async () => {
  const r = await api('GET', `/orders?status=${orderId ? 'confirmed' : 'pending'}`);
  return [r.status === 200 && r.data?.orders?.every((o) => o.status === 'confirmed'), r.status];
});

test('Admin', 'DELETE /api/messages/:id removes a message', async () => {
  const created = await api('POST', '/messages', {
    name: 'Cleanup', email: 'cleanup@example.com', message: 'delete me',
  });
  const id = created.data?.message?.id;
  const del = await api('DELETE', `/messages/${id}`);
  return [del.status === 200, del.status];
});

// ── Errors ───────────────────────────────────────────────────────────
test('Errors', 'Unknown /api route returns JSON 404', async () => {
  const r = await api('GET', '/does-not-exist');
  return [r.status === 404 && !!r.data?.error, r.status];
});

// ── Seed data ─────────────────────────────────────────────────────────
test('Seed data', 'bundled copy matches client/src/data/menu.js', async () => {
  // In a full monorepo checkout the two copies must stay in sync; when the
  // server ships alone (e.g. Render root directory = `server`) there is
  // nothing to compare against, so the check is skipped.
  const clientMenu = path.join(__dirname, '..', '..', 'client', 'src', 'data', 'menu.js');
  if (!fs.existsSync(clientMenu)) return [true, 'client copy not present — skipped'];
  const client = await import(pathToFileURL(clientMenu).href);
  const bundled = await import('../src/data/menu.js');
  const inSync =
    JSON.stringify(client.categories) === JSON.stringify(bundled.categories)
    && JSON.stringify(client.menuItems) === JSON.stringify(bundled.menuItems);
  return [inSync, 'server/src/data/menu.js has drifted from client/src/data/menu.js'];
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