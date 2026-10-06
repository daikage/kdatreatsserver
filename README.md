# KDB Treats — Server

Express + SQLite REST API for the KDB Treats storefront.

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

The database file is created automatically at `data/kdbtreats.db` on first run.
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

### Orders

| Method | Endpoint                | Description                          |
| ------ | ----------------------- | ------------------------------------ |
| POST   | `/orders`               | Create an order                      |
| GET    | `/orders`               | List recent orders (`?limit=`)       |
| GET    | `/orders/:id`           | Order with its line items            |
| PATCH  | `/orders/:id/status`    | Update order status                  |

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

## Configuration

| Variable      | Default                 | Description                        |
| ------------- | ----------------------- | ---------------------------------- |
| `PORT`        | `4000`                  | HTTP port                          |
| `DB_PATH`     | `data/kdbtreats.db`     | SQLite file location               |
| `CORS_ORIGIN` | reflect request origin  | Allowed client origin              |

## Project structure

```
server/
├── src/
│   ├── index.js          # App entry, middleware, server bootstrap
│   ├── db.js             # SQLite connection, schema, transaction helper
│   ├── seed.js           # Seeds from client/src/data/menu.js
│   └── routes/
│       ├── menu.js       # Categories + menu items
│       ├── orders.js     # Order creation and tracking
│       └── messages.js   # Contact form submissions
├── test/
│   └── api.test.js       # End-to-end API tests
└── data/                 # SQLite file (gitignored)
```

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

- **No authentication yet.** The admin routes (`PATCH /menu/:id`,
  `GET /orders`, `GET /messages`) are open. Add auth before going live.
- Add rate limiting on `POST /orders` and `POST /messages`.
- Consider adding order status notifications (email/SMS) as orders progress.