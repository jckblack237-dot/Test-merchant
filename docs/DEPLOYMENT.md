# Deployment

## Before you go live

**1. Generate real secrets.** The server refuses to boot in production without
them, and refuses to boot if they are still the development defaults.

```bash
openssl rand -hex 48   # once each for ACCESS_TOKEN_SECRET,
                       # REFRESH_TOKEN_SECRET and QR_TOKEN_SECRET
```

Rotating `ACCESS_TOKEN_SECRET` signs everyone out. Rotating `QR_TOKEN_SECRET`
invalidates wallet codes currently on screen — harmless, they refresh every two
minutes.

**2. Set the environment.** Copy `.env.example` to `server/.env`:

```bash
NODE_ENV=production
PORT=4000
DATABASE_PATH=/var/lib/loyaltyloop/loyaltyloop.sqlite
ACCESS_TOKEN_SECRET=…
REFRESH_TOKEN_SECRET=…
QR_TOKEN_SECRET=…
CORS_ORIGINS=https://app.yourdomain.com,https://merchants.yourdomain.com
BCRYPT_ROUNDS=12
TRIAL_DAYS=14
```

`CORS_ORIGINS` is an exact allow-list. Get it wrong and the frontends cannot
reach the API — which is the correct failure mode for a multi-tenant data store.

**3. Build and run.**

```bash
npm ci
npm run build
npm start --workspace server
```

The frontends build to `apps/customer/dist` and `apps/merchant/dist`. Serve them
as static files from any CDN or web server. Both are single-page apps: rewrite
unknown paths to `index.html`, or deep links will 404.

**4. Terminate TLS in front of the API** — nginx, Caddy, or your platform's load
balancer. The app sets `trust proxy` in production so client IPs in the audit log
and rate limiter come from `X-Forwarded-For`. Only put it behind a proxy that
actually sets that header, or clients can spoof their IP.

## Moving off SQLite

SQLite is genuinely fine for a long time: WAL mode means dashboard reads do not
block point awards, and a single café chain will not trouble it. Move to
PostgreSQL when you outgrow one machine or want managed backups and replicas.

The work is contained. All SQL lives in three places:

- `server/src/db/schema.ts` — table definitions
- `server/src/db/tenant.ts` — the query builder every tenant read and write uses
- a handful of hand-written aggregates in `routes/merchant/dashboard.ts`,
  `members.ts` and `points.ts`

Porting notes: `TEXT PRIMARY KEY` and ISO-8601 timestamp strings carry over
unchanged; swap `INTEGER` booleans for `BOOLEAN`; `better-sqlite3`'s synchronous
API becomes `async`, so `TenantStore` methods and their callers gain `await`;
`db.transaction(fn)()` becomes a client checkout with `BEGIN`/`COMMIT`.

**Once on PostgreSQL, add row-level security as a second layer.** Set
`app.merchant_id` per connection and add an `RLS` policy on every tenant table.
The application-layer scoping in `TenantStore` stays; RLS means the database
enforces the same rule independently, so a future bug in application code fails
closed.

## Backups

The whole dataset is one SQLite file. Do not copy it while the server is
running — use the online backup API, which is consistent:

```bash
sqlite3 /var/lib/loyaltyloop/loyaltyloop.sqlite \
  ".backup '/backups/loyaltyloop-$(date +%F).sqlite'"
```

Back up hourly and keep 30 days. Restore-test quarterly — an untested backup is
a hope, not a backup.

## Operating it

**Health check:** `GET /api/health` returns `{"status":"ok"}`. Point your load
balancer and uptime monitor at it.

**Logs to watch.** The `security_events` table records failed logins, refresh
token replay, and tokens whose merchant claim does not match the account.
Alert on:

- refresh token reuse (`kind = 'refresh_token_reuse'`) — a real signal of token
  theft, and rare enough that any occurrence deserves a look
- a spike in `login_failed` from one IP — credential stuffing
- any `token_merchant_mismatch` — should be impossible; investigate immediately

**Per-tenant audit.** `audit_logs` is scoped to each merchant and is what you
show a customer asking "who changed this?". It is append-only; nothing in the
API updates or deletes from it.

## Scaling

The API is stateless apart from the database, so it scales horizontally as soon
as you move to PostgreSQL. Before that, one process on one machine is the
limit — which is a real ceiling, not a theoretical one, so plan the migration
before your first large chain signs.

Rate limits are currently per-process and in-memory. Behind more than one
instance, move them to Redis (`express-rate-limit` has a store for it) or the
limits multiply by the number of instances.
