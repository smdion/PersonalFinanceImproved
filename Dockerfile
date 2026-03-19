# Stage 1: Install dependencies
FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Stage 2: Build
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1

# App version — passed at build time, baked into the Next.js bundle
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

# Build-time placeholders — Next.js validates env during static generation.
# Real values are injected at runtime via container environment variables.
ENV DATABASE_HOST=build-placeholder
ENV DATABASE_PORT=5432
ENV DATABASE_USER=build-placeholder
ENV DATABASE_PASSWORD=build-placeholder
ENV DATABASE_NAME=build-placeholder
ENV NEXTAUTH_SECRET=build-placeholder-secret-at-least-32-chars
ENV NEXTAUTH_URL=http://localhost:3000
ENV AUTH_TRUST_HOST=true
ENV AUTH_AUTHENTIK_ISSUER=https://build-placeholder/application/o/ledgr/
ENV AUTH_AUTHENTIK_ID=build-placeholder
ENV AUTH_AUTHENTIK_SECRET=build-placeholder

RUN pnpm build

# Stage 3: Production runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# App version — inherited from build arg for health endpoint
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy drizzle migrations and runtime db:migrate script
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/db-migrate.ts ./db-migrate.ts
COPY --from=builder /app/seed-reference-data.sql ./seed-reference-data.sql

# Install tsx + migration dependencies (not in standalone output)
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@latest --activate && \
    pnpm add -g tsx && \
    cd /app && pnpm add drizzle-orm pg

COPY docker-entrypoint.sh ./docker-entrypoint.sh

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "const http = require('http'); const req = http.get('http://localhost:3000/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => process.exit(1)); req.setTimeout(5000, () => { req.destroy(); process.exit(1); });"

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["sh", "docker-entrypoint.sh"]
