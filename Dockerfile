# Stage 1: Install dependencies
FROM node:26.13.0-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS deps
RUN apk add --no-cache python3 make g++
RUN npm install -g pnpm@10.32.1
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Stage 2: Build
FROM node:26.13.0-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS builder
RUN npm install -g pnpm@10.32.1
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1

# App version — passed at build time, baked into the Next.js bundle
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

# Build-time placeholders — Next.js validates env during static generation.
# Real values are injected at runtime via container environment variables.
# DATABASE_URL with a postgres:// prefix so env validation uses PG schema;
# runtime containers override or omit this for SQLite.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV NEXTAUTH_SECRET=build-placeholder-secret-at-least-32-chars
ENV NEXTAUTH_URL=http://localhost:3000
ENV AUTH_TRUST_HOST=true
ENV AUTH_AUTHENTIK_ISSUER=https://build-placeholder/application/o/ledgr/
ENV AUTH_AUTHENTIK_ID=build-placeholder
ENV AUTH_AUTHENTIK_SECRET=build-placeholder

RUN pnpm build

# Bundle the migrator (db-migrate.ts) with its JS dependencies (drizzle-orm,
# pg) into one db-migrate.js. better-sqlite3 stays external: it's a native
# addon, linked to Next's traced copy in the runner stage below.
RUN pnpm build:migrator

# Stage 3: Production runner
FROM node:26.13.0-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# App version — inherited from build arg for health endpoint
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

# OCI image metadata for provenance and traceability
LABEL org.opencontainers.image.title="Ledgr"
LABEL org.opencontainers.image.description="Personal finance dashboard"
LABEL org.opencontainers.image.version="${APP_VERSION}"
LABEL org.opencontainers.image.source="https://github.com/seandion/ledgr"
LABEL org.opencontainers.image.licenses="MIT"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone output (includes node_modules traced by @vercel/nft).
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy drizzle migrations (both PG and SQLite) and compiled db:migrate script
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle-sqlite ./drizzle-sqlite
COPY --from=builder /app/db-migrate.js ./db-migrate.js
# db-migrate.js requires better-sqlite3 from /app/node_modules, where the
# standalone output has it only under .pnpm/. Link the copy Next traced for
# server.js, and fail the build here if it doesn't load.
RUN set -e; \
    if [ ! -e node_modules/better-sqlite3 ]; then \
      set -- node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3; \
      if [ "$#" -ne 1 ] || [ ! -f "$1/package.json" ]; then \
        echo "Expected one traced better-sqlite3 package, found: $*" >&2; exit 1; \
      fi; \
      ln -s "${1#node_modules/}" node_modules/better-sqlite3; \
    fi; \
    node -e "new (require('better-sqlite3'))(':memory:').close()"
# The tax-data file (reference data), read from disk by db-migrate.js and the app.
COPY --from=builder /app/tax-data ./tax-data

COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod 555 docker-entrypoint.sh

# Default SQLite data directory — writable by nextjs user.
# Mount a volume here for persistence: -v ledgr_data:/app/data
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "const http = require('http'); const req = http.get('http://localhost:3000/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => process.exit(1)); req.setTimeout(5000, () => { req.destroy(); process.exit(1); });"

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["./docker-entrypoint.sh"]
