/**
 * Admin passcode auth.
 *
 * The admin panel is protected by a shared passcode:
 *   - `ADMIN_PASSCODE` env var (defaults to a known dev value with a warning).
 *   - `POST /api/admin/login { passcode }` returns a signed HMAC token.
 *   - Protected routes require `Authorization: Bearer <token>`.
 *
 * Tokens are stateless (HMAC-signed, 12h expiry), so no session store is
 * needed and the admin can be scaled horizontally.
 */
import crypto from 'node:crypto';

const DEFAULT_PASSCODE = 'KDAtreats-admin';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const ISSUER = 'KDAtreats-admin';

let warned = false;

export function getAdminPasscode() {
  const passcode = process.env.ADMIN_PASSCODE?.trim() || DEFAULT_PASSCODE;
  if (passcode === DEFAULT_PASSCODE && !warned) {
    warned = true;
    console.warn(
      `[admin] WARNING: default passcode "${DEFAULT_PASSCODE}" is in use. ` +
      'Set the ADMIN_PASSCODE env var to change it.',
    );
  }
  return passcode;
}

/** Timing-safe comparison against the configured passcode. */
export function verifyPasscode(passcode) {
  const a = Buffer.from(String(passcode ?? ''));
  const b = Buffer.from(getAdminPasscode());
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Issue a signed, expiring token for the current admin passcode. */
export function signAdminToken() {
  const payload = `${ISSUER}:${Date.now()}`;
  const sig = crypto.createHmac('sha256', getAdminPasscode()).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

/** Validate a token; returns true when the signature and expiry check out. */
export function verifyAdminToken(rawToken) {
  if (!rawToken) return false;

  let decoded;
  try {
    decoded = Buffer.from(String(rawToken), 'base64url').toString('utf8');
  } catch {
    return false;
  }

  const [issuer, issuedAt, sig] = decoded.split(':');
  if (issuer !== ISSUER || !issuedAt || !sig) return false;

  const age = Date.now() - Number(issuedAt);
  if (!Number.isFinite(age) || age < 0 || age > TOKEN_TTL_MS) return false;

  const expected = crypto
    .createHmac('sha256', getAdminPasscode())
    .update(`${ISSUER}:${issuedAt}`)
    .digest('hex');

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Express middleware — reject requests without a valid admin token. */
export function requireAdmin(req, res, next) {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!verifyAdminToken(token)) {
    return res.status(401).json({ error: 'Admin passcode required' });
  }
  next();
}