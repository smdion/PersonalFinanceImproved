# Ledgr

A self-hosted personal finance dashboard for tracking income, budgets, investments, net worth, and retirement projections — all in one place.

## Features

### Core Modules

- **Paycheck Calculator** — Gross-to-net breakdown with federal/state taxes, FICA, deductions, and 401k/HSA/IRA contributions. Supports multiple pay frequencies and filing statuses.
- **Budget Management** — Category-based budgeting with YNAB and Actual Budget sync support. Track spending against targets with real-time budget API integration.
- **Portfolio Tracking** — Multi-account portfolio with asset allocation, performance history, tax-location analysis, and rebalancing tools. Supports brokerage and retirement account types.
- **Net Worth** — Year-over-year net worth tracking with asset and liability breakdowns, trend visualization, and milestone tracking.
- **Retirement Planning** — Monte Carlo simulations with both accumulation and decumulation phases, validated against Trinity Study benchmarks. 8 withdrawal strategies (Fixed, Forgo-Inflation, Spending Decline, Constant Percentage, Endowment, Vanguard Dynamic, Guyton-Klinger, RMD-Based), per-person retirement ages and Social Security, IRMAA cliff detection, RMD tracking, lump-sum injections, and configurable filing status. A "Plan Health" card surfaces contribution-order warnings, glide-path mismatches, rosy-assumption flags, and a recommended withdrawal strategy in context.
- **Contributions** — Household contribution analysis with savings rate summary, per-person account breakdown, employer match analysis, IRS limit enforcement, prior-year tax contributions, and multiple contribution profiles.
- **Savings Goals** — Fund-based savings tracking with contribution allocation and projections.
- **Mortgage** — Amortization tables, refinance comparison, and extra payment modeling.
- **Expenses** — Expense tracking and categorization across accounts.
- **Assets & Liabilities** — Detailed tracking of real estate, vehicles, and other assets alongside debts and obligations.
- **Performance & Historical** — Investment performance analytics and historical data views.
- **What-If Scenarios** — Compare financial outcomes across different life scenarios.

### Platform Features

- **Tax Engine** — Federal tax engine with 2025/2026 brackets verified against IRS Rev. Proc. 2025-32, FICA, Additional Medicare Tax, LTCG graduated rates (progressive stacking), NIIT surtax, SECURE 2.0 super catch-up contributions, and Social Security taxation. LTCG and IRMAA brackets stored in database with year/filing-status versioning. A CI freshness check fails the build if the current calendar year moves beyond the latest pinned tax year without a deliberate override.
- **Monte Carlo Simulation** — Probabilistic retirement outcome modeling with configurable parameters.
- **Credential Encryption at Rest** — YNAB and Actual Budget API tokens are encrypted with AES-256-GCM before being stored in the database. Existing plaintext rows are transparently upgraded on first write.
- **SSRF Protection** — User-supplied Actual Budget server URLs are validated against private IP ranges; the app refuses to connect to RFC1918, loopback, or link-local addresses unless a host is explicitly added to `ALLOWED_ACTUAL_HOSTS`.
- **Onboarding Wizard** — Guided setup for new users with demo profiles to explore the app before entering real data.
- **Demo Mode** — Read-only demo mode with profile chooser (no login required).
- **Dark Mode** — Full dark/light theme support with semantic design tokens and a CI-enforced theme audit.
- **Accessibility** — WCAG AA-aligned contrast, `prefers-reduced-motion` support, keyboard skip-to-content, focus trapping in dialogs, screen-reader error announcements, and full ARIA coverage on inline icons and table semantics.
- **RBAC** — Role-based access control via Authentik OIDC integration with granular viewer permissions.
- **Raw Data Browser** — Admin-only live database table viewer with row counts, column metadata, paginated data, and JSON export.
- **Help & Guide** — Walkthrough of every feature organized by section, plus an in-app glossary for finance jargon.
- **Auto-Versioning** — Automatic database snapshots on startup for pre-migration recovery points.
- **Cross-Version Backup Import** — Import backups from older schema versions; data is automatically transformed to the current schema.
- **CLI Backup Tools** — `pnpm backup:export` and `pnpm backup:import` for headless environments; a separate `scripts/backup.sh` runs `pg_dump` wrapped in AES-256 encryption for off-site backups.
- **Health Check** — Built-in `/api/health` endpoint for container orchestration. A separate authenticated `/api/health/detailed` endpoint (gated by `CRON_SECRET`) exposes pool stats and budget API status.

## Quick Start

### Docker Compose (Recommended)

```bash
# Clone the repository
git clone <repo-url> && cd ledgr

# Configure environment
cp .env.example .env
# Edit .env — at minimum set NEXTAUTH_SECRET, CRON_SECRET, and ENCRYPTION_KEY

# Start the app (SQLite, zero config)
docker compose up -d

# Or with PostgreSQL:
# docker compose -f docker-compose.postgres.yml up -d
```

By default, Ledgr uses SQLite — no database setup required. For PostgreSQL, use the postgres compose file or set `DATABASE_URL` in `.env`. On first launch, migrations run automatically and you'll see the onboarding wizard.

### Generate Secrets

```bash
# Generate NEXTAUTH_SECRET, CRON_SECRET, and ENCRYPTION_KEY
# (each is an independent random 32-byte base64 value)
openssl rand -base64 32
openssl rand -base64 32
openssl rand -base64 32
```

`ENCRYPTION_KEY` protects at-rest encryption of YNAB / Actual Budget API tokens stored in the database. If you're running in `DEMO_ONLY` mode only, it can be omitted — demo mode blocks all credential writes at the server layer.

## Configuration

All configuration is done through environment variables. Copy `.env.example` to `.env` and adjust as needed.

### Required

| Variable          | Description                                                                                                                                                                                                                                       | Default             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `NEXTAUTH_URL`    | Full URL where the app is hosted (e.g. `http://localhost:3000`)                                                                                                                                                                                   | _(none — must set)_ |
| `NEXTAUTH_SECRET` | Random secret for session encryption. Generate with `openssl rand -base64 32`                                                                                                                                                                     | _(none — must set)_ |
| `AUTH_TRUST_HOST` | Trust the `X-Forwarded-Host` header (set `true` behind a reverse proxy)                                                                                                                                                                           | `true`              |
| `CRON_SECRET`     | Secret token for authenticating cron job API calls. Required in production — startup fails without it                                                                                                                                             | _(none — must set)_ |
| `ENCRYPTION_KEY`  | 32-byte base64 key for AES-256-GCM encryption of budget API credentials at rest (see `api_connections.config`). Required in production — startup fails without it. Generate with `openssl rand -base64 32`. **Not required in `DEMO_ONLY` mode.** | _(none — must set)_ |

### Optional — Database

| Variable       | Description                                                                                    | Default           |
| -------------- | ---------------------------------------------------------------------------------------------- | ----------------- |
| `DATABASE_URL` | PostgreSQL connection string (e.g. `postgresql://user:pass@host:5432/ledgr`). Omit for SQLite. | _(none — SQLite)_ |
| `SQLITE_PATH`  | Path to SQLite database file (only used when `DATABASE_URL` is not set)                        | `data/ledgr.db`   |

### Optional — Authentication

| Variable                | Description                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `ALLOW_DEV_MODE`        | Set `true` to enable dev-mode credentials login (type any name to log in, no Authentik needed) |
| `AUTH_AUTHENTIK_ISSUER` | Authentik OIDC issuer URL (e.g. `https://auth.example.com/application/o/ledgr`)                |
| `AUTH_AUTHENTIK_ID`     | Authentik OIDC client ID                                                                       |
| `AUTH_AUTHENTIK_SECRET` | Authentik OIDC client secret                                                                   |
| `DEMO_ONLY`             | Set `true` for demo-only mode — no login required, read-only with profile chooser              |

### Budget API Integration

YNAB and Actual Budget credentials are not configured via environment variables. After signing in as an admin, set them up in **Settings → Integrations**. Credentials are encrypted at rest with AES-256-GCM using `ENCRYPTION_KEY` before being stored in the `api_connections` table. See [Budget API Integration](#budget-api-integration-1) below for details.

## Architecture

```
┌──────────────────────────────────────────────┐
│                  Browser                     │
│            (React + Recharts)                │
└──────────────┬───────────────────────────────┘
               │ tRPC (type-safe RPC)
┌──────────────▼───────────────────────────────┐
│              Next.js 16                      │
│         App Router + API Routes              │
│    NextAuth.js (Authentik OIDC / Dev Mode)   │
├──────────────────────────────────────────────┤
│              tRPC Routers                    │
│     (paycheck, budget, portfolio, etc.)      │
├──────────────────────────────────────────────┤
│           Drizzle ORM (strict)               │
└──────────────┬───────────────────────────────┘
               │ SQL
┌──────────────▼───────────────────────────────┐
│     SQLite (default) or PostgreSQL 16        │
│    (migrations managed by Drizzle Kit)       │
└──────────────────────────────────────────────┘
```

**Key design decisions:**

- **End-to-end type safety** — TypeScript strict mode from database schema (Drizzle) through API (tRPC) to UI (React).
- **Data-driven design** — Data shapes are the source of truth. Renderers are category-agnostic and read fields to render what's present. Display logic lives in data presence, not in call-site decisions.
- **Self-hosted** — No external SaaS dependencies. SQLite by default (zero config), PostgreSQL supported. Budget APIs (YNAB, Actual) are optional integrations.

## Development

### Prerequisites

- Node.js 25+
- pnpm (`npm install -g pnpm`)
- PostgreSQL 16+ _(optional — SQLite is used by default)_

### Setup

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env — set NEXTAUTH_SECRET and CRON_SECRET
# Optionally set DATABASE_URL for PostgreSQL

# Run database migrations
pnpm db:migrate

# Start development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). On first launch you'll see the onboarding wizard.

### Commands

| Command              | Description                                  |
| -------------------- | -------------------------------------------- |
| `pnpm dev`           | Start development server                     |
| `pnpm build`         | Production build                             |
| `pnpm start`         | Start production server                      |
| `pnpm test`          | Run all tests                                |
| `pnpm test:watch`    | Run tests in watch mode                      |
| `pnpm lint`          | Lint and format check                        |
| `pnpm format`        | Auto-format with Prettier                    |
| `pnpm db:generate`   | Generate a new migration from schema changes |
| `pnpm db:migrate`    | Run pending migrations                       |
| `pnpm db:studio`     | Open Drizzle Studio (visual DB browser)      |
| `pnpm backup:export` | Export all data to JSON (stdout or `--out`)  |
| `pnpm backup:import` | Import a JSON backup (supports `--dry-run`)  |

### Authentication Modes

Ledgr supports three authentication modes:

| Mode               | When                                              | How                                                                                                                   |
| ------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Local Admin**    | Always available                                  | Email/password login against a `local_admins` table. The first admin account is created during the onboarding wizard. |
| **Authentik OIDC** | `AUTH_AUTHENTIK_ISSUER` is set                    | SSO via Authentik with RBAC group mapping. Shows as primary login button alongside the local admin form.              |
| **Dev Mode**       | `ALLOW_DEV_MODE=true` and no Authentik configured | Type any name to auto-login as admin. For local development only — never use in production.                           |

In production, use **Authentik OIDC** for SSO or **Local Admin** for standalone self-hosted deployments without an identity provider.

## Deployment

### Docker (Production)

The included `Dockerfile` uses a multi-stage build for a minimal production image:

1. **deps** — Installs dependencies with `pnpm install --frozen-lockfile`
2. **builder** — Builds the Next.js app with standalone output
3. **runner** — Minimal Alpine image with only the standalone build, migrations, and a non-root `nextjs` user

The entrypoint (`docker-entrypoint.sh`) automatically runs pending database migrations before starting the server.

```bash
# Build and start
docker compose up -d --build

# View logs
docker compose logs -f ledgr

# Restart after config changes
docker compose restart ledgr
```

**Production notes:**

- The app listens on port **3000** by default.
- A built-in **healthcheck** hits `/api/health` every 30 seconds.
- The container has a **1 GB memory limit** set in docker-compose.yml.
- For HTTPS, place a reverse proxy (NGINX, Caddy, Traefik, etc.) in front of the app and set `NEXTAUTH_URL` to your public URL.
- Set `AUTH_TRUST_HOST=true` when running behind a reverse proxy.
- **SQLite mode**: The data volume (`ledgr_data`) persists the database file across container restarts. **PostgreSQL mode**: Data lives in the external PostgreSQL instance.

### Authentik OIDC Setup

For production authentication, configure an Authentik OIDC provider:

1. Create an OAuth2/OIDC application in Authentik for Ledgr.
2. Set the redirect URI to `https://your-domain/api/auth/callback/authentik`.
3. Copy the client ID and secret into `AUTH_AUTHENTIK_ID` and `AUTH_AUTHENTIK_SECRET`.
4. Set `AUTH_AUTHENTIK_ISSUER` to the issuer URL.

## Budget API Integration

Ledgr supports syncing budget data from two external sources. Both are configured from the in-app **Settings → Integrations** page — there are no environment variables for credentials. Whatever you enter is encrypted at rest with AES-256-GCM using the `ENCRYPTION_KEY` env var before being stored.

- **YNAB (You Need A Budget)** — Generate a personal access token at [YNAB Developer Settings](https://app.ynab.com/settings/developer), paste it into Settings → Integrations, and pick a budget from the list the UI fetches. Syncs accounts, categories, monthly summaries, and transactions with delta-sync support for fast incremental updates.
- **Actual Budget** — Requires a running [Actual Budget HTTP API](https://github.com/jhonderson/actual-http-api) wrapper in front of your Actual server. Enter the server URL, API key, and budget sync ID in Settings → Integrations. Outbound requests to private IP ranges (RFC1918, loopback, link-local) are blocked by default; add specific hosts to `ALLOWED_ACTUAL_HOSTS` if you need to reach a private network.

Only one integration can be active at a time, controlled from the Integrations page. Both are optional — Ledgr's budgeting features work without either.

The integration layer hardens every outbound call: typed error classification, automatic exponential backoff with `Retry-After` support on rate limits, deterministic idempotency keys so retries don't create duplicate transactions, and drift detection after every sync that surfaces broken account mappings directly in the UI.

## Testing

2,970+ tests across 142 vitest files plus 13 Playwright end-to-end specs, covering financial calculators, retirement benchmarks, server logic, UI components, database operations, theme token regressions, and end-to-end browser flows. CI enforces a 85% statement / 70% branch / 80% function / 85% line coverage threshold.

```bash
pnpm test          # Run once
pnpm test:watch    # Watch mode
pnpm test:e2e      # End-to-end browser tests (Playwright)
pnpm test:coverage # Run with coverage thresholds
```

## Tech Stack

- [Next.js 16](https://nextjs.org/) (App Router, Turbopack, standalone output)
- [TypeScript](https://www.typescriptlang.org/) (strict mode)
- [tRPC](https://trpc.io/) (end-to-end type-safe API)
- [Drizzle ORM](https://orm.drizzle.team/) + SQLite / PostgreSQL 16
- [Tailwind CSS](https://tailwindcss.com/)
- [Recharts](https://recharts.org/) (charts and visualizations)
- [NextAuth.js](https://next-auth.js.org/) (authentication via Authentik OIDC)
- [Zod](https://zod.dev/) (runtime validation)
- [Vitest](https://vitest.dev/) (testing)

## Contributing

Contributions are welcome! Please open an issue to discuss before submitting a PR.

## License

[MIT](LICENSE)
