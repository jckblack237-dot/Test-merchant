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

The frontends build to `apps/customer/dist`, `apps/merchant/dist` and
`apps/island/dist`. Serve them as static files from any CDN or web server. Both are single-page apps: rewrite
unknown paths to `index.html`, or deep links will 404.

**4. Terminate TLS in front of the API** — nginx, Caddy, or your platform's load
balancer. The app sets `trust proxy` in production so client IPs in the audit log
and rate limiter come from `X-Forwarded-For`. Only put it behind a proxy that
actually sets that header, or clients can spoof their IP.

## In one container

`Dockerfile` builds all four workspaces into one image: the API, the built
frontends, and nothing else. Four stages — install (with a C toolchain, because
`better-sqlite3` compiles from source whenever no prebuilt binding matches the
platform), build, a clean production-only dependency install, and a runtime
stage that runs as the unprivileged `node` user.

```bash
docker build -t loyaltyloop .
docker run -d --name loyaltyloop \
  -p 4000:4000 \
  -v loyaltyloop-data:/data \
  --env-file server/.env \
  loyaltyloop
```

The image already sets `DATABASE_PATH=/data/loyaltyloop.sqlite` and
`PUBLIC_DIR=/app/public/island`. Do not override the first; override the second
only to serve a different app. `.dockerignore` keeps `node_modules`, `dist`,
`.env` and every `*.sqlite` out of the build context — a native binding built on
your laptop will not load inside the image, and a database file copied into a
layer would ship as though it were the deployment's own data.

### The volume is the database

`/data` is a mount point and nothing else. Write the database anywhere else —
the development default `./data/loyaltyloop.sqlite`, or any path outside the
mount — and every deploy silently starts from an empty file, because the
container filesystem is rebuilt from the image each time. Nobody notices until a
merchant asks where their members went.

The image creates `/data` owned by uid 1000 (`node`), the user the server runs
as, so a plain `docker run -v name:/data` inherits that ownership. A managed
volume does not: Fly and Render each attach a freshly formatted filesystem whose
root is owned by `root`, and neither documents what it does about ownership. The
symptom is a boot that dies on `SQLITE_CANTOPEN` and says nothing about
permissions. Fix it once, from a root shell on the host:

```bash
fly ssh console -C 'chown 1000:1000 /data' && fly apps restart loyaltyloop
```

The image does not work around this by running as root. An application that can
rewrite the code it is running is a worse trade than a boot failure you fix once.

### The health check

`HEALTHCHECK` makes a real `GET /api/health` and requires `status: ok` in the
body. A TCP probe, or `node -e "process.exit(0)"`, passes happily while the app
answers every caller with a 500. Reaching that endpoint proves the process is
serving HTTP, which means boot got past the secret checks and past opening the
database — it does not re-read the database on each probe. If you want a probe
that does, `GET /api/plans` is public and reads SQLite.

Fly and Render run their own checks against the same path; those are what gate a
deploy on either platform.

### One frontend per container

`PUBLIC_DIR` names the built app this process serves. The image carries all
three — `/app/public/customer`, `/app/public/merchant`, `/app/public/island` —
and defaults to the island. Point it at another to serve that one instead:

```bash
docker run … -e PUBLIC_DIR=/app/public/merchant loyaltyloop
```

A wrong path fails the boot naming the path, rather than serving a directory of
404s that look like a routing bug. Left unset, the process serves the API alone.

Only one app, because all three are `BrowserRouter` SPAs that claim `/` and a
catch-all, and all three build with Vite's default `base: '/'`. Serving a second
under a prefix needs two changes in the frontend itself — `--base` at build time
and `basename={import.meta.env.BASE_URL}` on its router — which is not something
a container image should force on them.

**Do not run a second container of this image against the same database to get a
second frontend.** Two API processes on one SQLite file is not only the
write-lock question: `reconcileInterruptedMissions()` runs at boot and fails
*every* mission in the database still planning or running, so container B
starting up ends container A's live missions with an error the merchant reads as
a crash. Rate limits are per-process too (see Scaling). Serve the other apps as
static files the way step 3 above describes, from a host that proxies `/api` to
this container, and add their origins to `CORS_ORIGINS`.

### CORS, on a single origin

Set `CORS_ORIGINS` to the container's own public origin even though the frontend
is served by the API itself. Browsers attach `Origin` to every non-GET request,
same-origin included, so a sign-in `POST` arrives carrying
`https://loyaltyloop.fly.dev`; if that is not on the allow-list, the cors
middleware rejects it with an `Error`, which reaches the generic error handler as
`500 internal_error` and logs `[unhandled]`. Pages load, GETs work, signing in
fails, and nothing in the response says the word CORS. It is one missing origin,
and it is the first thing to check.

## Fly.io

`fly.toml` is optional and commented. Three things it settles that are easy to
get wrong:

**One Machine.** A volume attaches to exactly one Machine, and that volume is the
database. Run at `fly scale count 1`; a second Machine is a second, divergent
database.

**No stopping for idleness.** `auto_stop_machines = 'off'` with
`min_machines_running = 1`, because a mission is background work that outlives
the request which started it: a dozen-odd model calls over several minutes,
watched over an SSE stream the browser may drop. Stop the Machine in the middle
and that mission is closed out as interrupted on the next boot.

**Secrets are not `[env]`:**

```bash
fly secrets set \
  ACCESS_TOKEN_SECRET=$(openssl rand -hex 48) \
  REFRESH_TOKEN_SECRET=$(openssl rand -hex 48) \
  QR_TOKEN_SECRET=$(openssl rand -hex 48)
fly secrets set ANTHROPIC_API_KEY=… MARKET_DATA_API_KEY=…   # optional, see below
```

`CORS_ORIGINS` in `[env]` assumes the default `<app>.fly.dev` hostname; rename
the app and you must rename it too.

Deliberately absent: `[deploy] release_command` — a release machine runs without
the volume attached, so it can neither migrate this database nor fix the mount's
ownership — along with process groups and anything about autoscaling. Fields that
could not be confirmed against the current `fly.toml` reference were left out
rather than guessed at.

## Render

`render.yaml` is optional. `runtime: docker` is the current key (`env` is
deprecated) and `autoDeployTrigger` replaced `autoDeploy`.

The three signing secrets use `generateValue: true`, which Render documents as a
randomised base64-encoded 256-bit value: comfortably past the 32-character floor,
and by construction never the development default the server refuses to boot on.
The two API keys use `sync: false`, so Render prompts for them once when the
Blueprint is created and neither is ever written into the repository.

A disk needs a paid instance type — `0.5c-512mb` is the cheapest that can mount
one — and `sizeGB` can be increased later but never reduced. Keep the service at
one instance, for the same reason Fly gets one Machine.

`CORS_ORIGINS` is a literal `https://loyaltyloop.onrender.com` because the
Blueprint spec's `fromService` reference to a service's own hostname could not be
verified; correct it to the URL Render actually assigns, which gains a suffix if
the name is already taken. `PORT` is pinned to 4000 only to keep the container
and the image agreeing — Render sets `PORT` itself (10000 by default) and the
server binds whatever it is given.

## What the island spends

The roster is seventeen agents: nine core, which always sail, and eight
specialists a merchant switches on. One mission is at least one model request per
agent the Task Manager keeps, and then:

- a research agent takes two — a search turn, then the forced submit turn — and
  web search is billed per search on top of tokens (`ISLAND_MAX_WEB_SEARCHES`
  caps them per agent);
- every schema repair is another request (`ISLAND_MAX_REPAIRS`), as is every
  retry (`ISLAND_MAX_ATTEMPTS`);
- a failed verification gate re-runs the agents it named, up to
  `ISLAND_MAX_CORRECTION_ROUNDS` times;
- each follow-up question afterwards is one more request, and follow-ups are not
  counted against the daily mission budget.

So a mission is a dozen-odd requests at the floor and can be two or three times
that. The report itself costs nothing — it is assembled from what is on record.
Market data costs nothing at the model either: one HTTP request per mission that
resolves a currency pair, for the technical agent alone, against whatever quota
the provider key has.

`ISLAND_MISSIONS_PER_DAY` is the only limit that bounds any of it. It is per
merchant per day, so the ceiling is that number times your tenant list; the
per-IP limiter (30 mission starts an hour) is a brake on a runaway loop, not a
budget.

**Start at 5.** Five missions is somewhere between sixty and a hundred and fifty
model requests for one merchant in one day — enough for a merchant to do a
morning's real work, small enough that being wrong about it is a bill you can
still pay. The shipped default of 25 is a development convenience. Raise it once
you have seen a real invoice against a real roster, not before.
`ISLAND_ENABLED=false` refuses new missions without taking the pages away, which
is the switch to reach for if a bill surprises you mid-month.

Deploying with no `ANTHROPIC_API_KEY` is a supported configuration and costs
nothing: the island runs on the simulation engine and says so on every report.
Deploying with no `MARKET_DATA_API_KEY` is supported in the same way: the
Technical Analysis Agent reports that it was given no prices rather than
inventing a level. Neither degradation is quiet, and neither should be made
quiet to tidy up a deployment.

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
