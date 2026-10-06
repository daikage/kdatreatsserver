# KDA Treats — Server

Express + SQLite REST API for the KDA Treats storefront.

## Stack

- **Node 20+** with ES modules
- **Express 4** for routing
- **`node:sqlite`** — Node's built-in SQLite driver. No native compilation, no
  external database service, no `node-gyp`/Python build step.

## Getting started

```bash
npm install
npm run dev      # http://localhost:4000  (auto-reloads)
npm start        # production mode
npm run seed     # populate an empty database
npm run test:api # run the end-to-end API tests
```

The database file is created automatically at `data/KDAtreats.db` on first run.
Seeding runs automatically at startup only when the database is empty, so admin
edits (prices, availability) are never silently overwritten on restart. Use
`npm run seed -- --force` to deliberately rebuild the catalogue.

## API

Base URL: `http://localhost:4000/api`

### Health

| Method | Endpoint  | Description             |
| ------ | --------- | ----------------------- |
| GET    | `/health` | Uptime + status check   |

### Menu

| Method | Endpoint             | Description                             |
| ------ | -------------------- | --------------------------------------- |
| GET    | `/menu`              | Categories + all items                  |
| GET    | `/menu?category=grills` | Filter by category slug              |
| GET    | `/menu?featured=true`   | Only featured items                  |
| GET    | `/categories`        | Categories only                         |
| GET    | `/menu/:id`          | Single item (404 if unknown)            |
| PATCH  | `/menu/:id`          | Update `price`, `isAvailable`, `isFeatured` |
| POST   | `/menu`              | **Admin** — create a menu item          |
| PUT    | `/menu/:id`          | **Admin** — full item update (name, description, price, category, image, spiceLevel, availability, featured) |
| DELETE | `/menu/:id`          | **Admin** — delete a menu item          |
| POST   | `/categories`        | **Admin** — create a category (auto slug) |
| PUT    | `/categories/:id`    | **Admin** — update name/icon/sortOrder/slug |
| DELETE | `/categories/:id`    | **Admin** — delete a category (409 if items still use it) |

### Orders

| Method | Endpoint                | Description                          |
| ------ | ----------------------- | ------------------------------------ |
| POST   | `/orders`               | Create an order                      |
| GET    | `/orders`               | List orders (`?limit=`, `?status=`)  |
| GET    | `/orders/:id`           | Order with its line items            |
| PATCH  | `/orders/:id/status`    | Update order status                  |
| DELETE | `/orders/:id`           | **Admin** — delete an order          |

`POST /orders` body:

```json
{
  "customerName": "Ada Obi",
  "customerAddress": "12 Lekki Phase 1, Lagos",
  "customerPhone": "+2348000000000",
  "customerEmail": "ada@example.com",
  "customerNote": "Extra pepper please",
  "items": [{ "itemId": 1, "quantity": 2 }]
}
```

> **Prices are always recomputed server-side from the database.** Any `price`
> sent by the client is ignored, so totals cannot be tampered with. Items that
> do not exist or are unavailable are rejected with `400`/`409`.

Valid statuses: `pending`, `confirmed`, `preparing`, `out_for_delivery`,
`delivered`, `cancelled`.

### Messages (contact form)

| Method | Endpoint              | Description             |
| ------ | --------------------- | ----------------------- |
| POST   | `/messages`           | Submit a contact message |
| GET    | `/messages`           | List messages            |
| PATCH  | `/messages/:id/read`  | Mark read/unread        |
| DELETE | `/messages/:id`       | **Admin** — delete a message |

### Admin dashboard

| Method | Endpoint         | Description                                            |
| ------ | ---------------- | ------------------------------------------------------ |
| GET    | `/admin/stats`   | Revenue/order totals, status breakdown, last-7-days sales, recent orders, best sellers, unread messages |

### Admin passcode (auth)

The admin panel and admin endpoints are protected by a shared passcode.

| Method | Endpoint         | Description                                            |
| ------ | ---------------- | ------------------------------------------------------ |
| POST   | `/admin/login`   | Body `{ "passcode": "…" }` → `{ "token": "…" }`        |

1. Set `ADMIN_PASSCODE` (defaults to `KDAtreats-admin` with a console warning —
   change it before going live).
2. `POST /api/admin/login` returns a stateless HMAC-signed token (12h expiry).
3. Send it on every protected request: `Authorization: Bearer <token>`.

Protected endpoints: `GET /admin/stats`; `POST/PUT/DELETE /menu` and
`/menu/:id`; `PATCH /menu/:id`; category CRUD; `GET /orders`, `GET /orders/:id`,
`PATCH /orders/:id/status`, `DELETE /orders/:id`; `GET /messages`,
`PATCH /messages/:id/read`, `DELETE /messages/:id`.

Public endpoints (no token needed): `GET /menu`, `GET /menu/:id`,
`GET /categories`, `POST /orders`, `POST /messages`, `GET /health`.

## Configuration

| Variable      | Default                 | Description                        |
| ------------- | ----------------------- | ---------------------------------- |
| `PORT`        | `4000`                  | HTTP port                          |
| `ADMIN_PASSCODE` | `KDAtreats-admin`    | Passcode for the admin panel       |
| `SQLITE_PATH` | `data/KDAtreats.db`     | SQLite file location               |
| `DATABASE_URL`| —                       | `postgres://…` enables Postgres    |
| `CORS_ORIGIN` | reflect request origin  | Allowed client origin              |

## Project structure

```
server/
├── src/
│   ├── index.js          # App entry, middleware, server bootstrap
│   ├── db/
│   │   ├── index.js      # DB driver selection + shared query helpers
│   │   ├── migrate.js    # Idempotent schema (SQLite + Postgres)
│   │   ├── sqlite.js     # node:sqlite driver
│   │   └── postgres.js   # pg driver
│   ├── seed.js           # Seeds from client/src/data/menu.js
│   └── routes/
│       ├── menu.js       # Categories + menu items (+ admin CRUD)
│       ├── orders.js     # Order creation, tracking, admin delete
│       ├── messages.js   # Contact form submissions (+ admin delete)
│       └── admin.js      # Dashboard stats
├── test/
│   └── api.test.js       # End-to-end API tests
└── data/                 # SQLite file (gitignored)
```

> The legacy `src/db.js` module is no longer imported anywhere; all routes use
> the async driver in `src/db/index.js`.

## Running with the client

Start the API on port `4000`, then the client on its default port:

```bash
cd server && npm run dev
cd client && npm run dev
```

The client reads `VITE_API_URL` (defaults to `http://localhost:4000/api`).
Both the contact form and the cart checkout POST to this API; if the server
is unreachable the client gracefully falls back to WhatsApp so ordering still
works.

## Notes / future work

- **Auth is passcode-based and shared across all admins.** The signed token
  expires after 12 hours and the passcode is compared in constant time, but a
  production deployment should add per-admin accounts, a rate-limited login and
  HTTPS.
- Add rate limiting on `POST /orders`, `POST /messages` and `POST /admin/login`.
- Consider adding order status notifications (email/SMS) as orders progress.