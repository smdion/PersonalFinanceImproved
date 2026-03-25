# Stage 1: Install dependencies
FROM node:24.14.0-alpine@sha256:e9445c64ace1a9b5cdc60fc98dd82d1e5142985d902f41c2407e8fffe49d46a3 AS deps
RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Stage 2: Build
FROM node:24.14.0-alpine@sha256:e9445c64ace1a9b5cdc60fc98dd82d1e5142985d902f41c2407e8fffe49d46a3 AS builder
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
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

# Compile db-migrate.ts to JS using the TypeScript compiler already in devDeps.
# --moduleResolution bundler + --module nodenext works with the existing imports.
RUN pnpm exec tsc db-migrate.ts \
  --target ES2022 --module nodenext --moduleResolution nodenext \
  --esModuleInterop --skipLibCheck --outDir .

# Stage 3: Production runner
FROM node:24.14.0-alpine@sha256:e9445c64ace1a9b5cdc60fc98dd82d1e5142985d902f41c2407e8fffe49d46a3 AS runner
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
# outputFileTracingIncludes in next.config.mjs ensures better-sqlite3's
# native .node binary is included even though the build uses PG mode.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy drizzle migrations (both PG and SQLite) and compiled db:migrate script
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle-sqlite ./drizzle-sqlite
COPY --from=builder /app/db-migrate.js ./db-migrate.js
COPY --from=builder /app/seed-reference-data.sql ./seed-reference-data.sql

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
