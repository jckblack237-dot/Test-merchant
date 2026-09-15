# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# LoyaltyLoop in one container: the API, the three built frontends, and a
# SQLite file that lives on a mounted volume.
#
# The database is the whole product. A database written inside the image is
# rebuilt from the image on every deploy, so DATABASE_PATH points at /data and
# /data is a mount point and nothing else. See docs/DEPLOYMENT.md.
# ---------------------------------------------------------------------------

ARG NODE_VERSION=22

# --- install ---------------------------------------------------------------
# NODE_ENV is deliberately left unset until the runtime stage: `npm ci` under
# NODE_ENV=production omits devDependencies, and tsc and vite are both dev.
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app

# better-sqlite3 downloads a prebuilt binding when one matches this platform
# and compiles from source when none does. Without a toolchain that fallback
# fails at install time.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Manifests first: this layer only rebuilds when a dependency actually changes.
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY apps/customer/package.json apps/customer/
COPY apps/merchant/package.json apps/merchant/
COPY apps/island/package.json apps/island/
RUN npm ci

# --- build -----------------------------------------------------------------
FROM deps AS build
COPY . .
RUN npm run build

# --- production dependencies -----------------------------------------------
# A second clean install rather than `npm prune --omit=dev`: it resolves from
# the lock file, and better-sqlite3's native binding is produced by the same
# image the runtime stage is built from.
FROM deps AS prod-deps
RUN npm ci --omit=dev

# --- runtime ---------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    DATABASE_PATH=/data/loyaltyloop.sqlite
WORKDIR /app

# Application files stay root-owned and the server runs as `node`, so a
# compromised process cannot rewrite the code it is running.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY package.json ./
COPY server/package.json ./server/

# The built frontends. PUBLIC_DIR below picks which one this container serves;
# three single-page apps on one origin would each need their own base path and
# router basename, so a second app is a second container.
ENV PUBLIC_DIR=/app/public/island
COPY --from=build /app/apps/customer/dist ./public/customer
COPY --from=build /app/apps/merchant/dist ./public/merchant
COPY --from=build /app/apps/island/dist ./public/island

# uid 1000, shipped by the node image. Creating the mount point here is what
# lets a plain `docker run -v name:/data` inherit this ownership; a managed
# volume on a host like Fly does not — docs/DEPLOYMENT.md covers the one-time
# chown that needs.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node

EXPOSE 4000

# A real request through the whole stack — helmet, cors, the rate limiter, the
# router. A TCP probe or `node -e "process.exit(0)"` passes while the app is
# answering every caller with a 500.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/api/health').then(async (res) => { const body = await res.json().catch(() => null); process.exit(res.ok && body && body.status === 'ok' ? 0 : 1); }).catch(() => process.exit(1))"]

# config.ts resolves .env and its default data directory relative to the server
# package, so run from there even though node_modules is hoisted to /app.
WORKDIR /app/server
CMD ["node", "dist/index.js"]
