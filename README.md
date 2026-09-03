# Ledgr

A self-hosted personal finance dashboard for tracking income, budgets, investments, net worth, and retirement projections — all in one place. Runs on SQLite with zero configuration, or PostgreSQL for larger deployments. No external SaaS dependencies; budget-provider sync is an optional integration.

## Features

### Planning & projections

- **Retirement planning** — A full accumulation-and-decumulation projection engine with Monte Carlo simulation (labeled **Simulation** in the app), validated against Trinity Study benchmarks. Per-person retirement ages, Social Security amounts and start ages, and pre-retirement raise rates. Eight withdrawal strategies (Fixed, Forgo Inflation After Loss, Spending Decline, Constant Percentage, Endowment, Vanguard Dynamic, Guyton-Klinger, RMD Spending) and two withdrawal-routing modes (**Bracket Filling** — fill Traditional withdrawals up to a target tax bracket; **Waterfall** — drain accounts in a configured priority order, with an optional Roth-bracket overlay). Models RMDs and RMD smoothing, Qualified Charitable Distributions, the age-65+ standard deduction and the temporary OBBBA senior deduction, IRMAA cliff detection with a two-year MAGI lookback, ACA premium-subsidy cliffs, Rule-of-55 and early-withdrawal-penalty rules, lump-sum injections and withdrawals, and a multi-year Roth-conversion bracket-target optimizer.
- **Retirement Profiles** — Save, name, and duplicate whole sets of retirement assumptions to compare plans side by side. Each profile can pin itself to a specific tax year's tables so an old projection reproduces exactly.
- **Plan Health** — A card that surfaces contribution-order warnings, glide-path mismatches, rosy-assumption flags, and a recommended withdrawal strategy in context.
- **Print Advisor Report** — A purpose-built multi-page document: executive summary, Monte Carlo risk analysis with worst-case framing, a withdrawal-strategy narrative, an ACA/IRMAA watchlist, action items, and a condensed year-by-year table.
- **Coast FIRE** — Automatic Coast FIRE age plus a custom-age check for any age between now and your planned retirement.
- **Tax Buckets** — Per-account analysis of how much of each balance is reachable now, split into penalty-free and tax-free portions, with Roth ordering rules and Rule-of-55 eligibility applied.
- **What-If Scenarios** — Compare financial outcomes across different life scenarios without disturbing your baseline.

### Core modules

- **Paycheck Calculator** — Gross-to-net breakdown with federal tax withholding, FICA, Additional Medicare Tax, deductions, and 401k/HSA/IRA contributions. Multiple pay frequencies and filing statuses; a tax-year toggle to compare years.
- **Budget** — Category-based budgeting with per-profile funding, extra-paycheck handling, and optional two-way sync with YNAB or Actual Budget. Track spending against targets with drift detection.
- **Portfolio** — Multi-account portfolio with asset allocation, performance history, tax-location analysis, contribution-account tracking, and rebalancing tools. Snapshot pushes to YNAB/Actual post as reconciled.
- **Contributions** — Household contribution analysis: savings-rate summary, per-person account breakdown, employer-match analysis, IRS-limit enforcement, prior-year tax contributions, and multiple contribution profiles with a swap-diff compare view.
- **Net Worth** — Year-over-year net worth with asset and liability breakdowns, trend visualization, and a financial-independence progress card.
- **Savings Goals** — Fund-based savings tracking with per-profile contribution allocation, planned transactions, and projections; optional category links to YNAB/Actual.
- **Mortgage** — Amortization tables, refinance comparison, and extra-payment modeling.
- **Expenses** — Expense tracking and categorization across accounts.
- **Assets & Liabilities** — Detailed tracking of real estate, vehicles, and other assets alongside debts and obligations.
- **Performance & Historical** — Investment performance analytics and historical data views.
- **Analytics** — Cross-module trends and summaries.
- **Tools** — Relocation analysis: compare projected cost of living, taxes, and net outcome across locations.
- **Utilities** — Track utility services and meter readings over time.

### Platform

- **Tax engine** — Federal tax with 2025/2026 brackets verified against IRS Publication 15-T and Rev. Proc. 2025-32, FICA, Additional Medicare Tax, LTCG graduated rates (progressive stacking), NIIT surtax, SECURE 2.0 super catch-up contributions, and Social Security taxation. Contribution limits, tax brackets, LTCG brackets, IRMAA brackets, and Federal Poverty Level figures live in the database with year and filing-status versioning, editable from Settings. A CI freshness check fails the build if the calendar year moves past the latest pinned tax year without a deliberate override.
- **Credential encryption at rest** — YNAB, Actual Budget, and SimpleFIN tokens are encrypted with AES-256-GCM before being stored. Existing plaintext rows are transparently upgraded on first write.
- **SSRF protection** — User-supplied Actual Budget server URLs are validated against private IP ranges; the app refuses to connect to RFC1918, loopback, or link-local addresses unless a host is explicitly added to `ALLOWED_ACTUAL_HOSTS`.
- **RBAC** — Role-based access control via Authentik OIDC with granular viewer permissions, plus a standalone local-admin table for deployments without an identity provider.
- **Onboarding wizard & demo mode** — Guided first-run setup with demo profiles to explore before entering real data; a separate read-only `DEMO_ONLY` mode with a profile chooser and no login.
- **Dark mode & accessibility** — Full dark/light theming with semantic design tokens and a CI-enforced theme audit. WCAG AA-aligned contrast, `prefers-reduced-motion` support, keyboard skip-to-content, focus trapping in dialogs, screen-reader error announcements, and ARIA coverage on inline icons and table semantics.
- **Versioning & backup** — Automatic database snapshots on startup as pre-migration recovery points. Cross-version backup import transforms data from any older schema era (v0.2 onward) to the current shape. `pnpm backup:export` / `pnpm backup:import` for headless use, and `scripts/backup.sh` wraps `pg_dump` in AES-256 encryption for off-site backups.
- **Raw Data Browser** — Admin-only live database table viewer with row counts, column metadata, pagination, and JSON export.
- **Help & Guide** — A walkthrough of every feature by section, plus an in-app glossary for finance jargon.
- **Health checks** — `/api/health` for container orchestration; an authenticated `/api/health/detailed` (gated by `CRON_SECRET`) exposes pool stats and integration status.

## Quick Start

### Docker Compose (recommended)

```bash
git clone <repo-url> && cd ledgr

cp .env.example .env
# Edit .env — at minimum set NEXTAUTH_SECRET, CRON_SECRET, and ENCRYPTION_KEY

# SQLite, zero config:
docker compose up -d

# Or PostgreSQL:
# docker compose -f docker-compose.postgres.yml up -d
```

By default Ledgr uses SQLite — no database setup required. On first launch, migrations run automatically and you'll see the onboarding wizard.

### Generate secrets

```bash
# Each is an independent random 32-byte base64 value
openssl rand -base64 32   # NEXTAUTH_SECRET
openssl rand -base64 32   # CRON_SECRET
openssl rand -base64 32   # ENCRYPTION_KEY
```

`ENCRYPTION_KEY` protects at-rest encryption of budget-provider API tokens. In `DEMO_ONLY` mode it can be omitted — demo mode blocks all credential writes at the server layer.

## Configuration

All configuration is through environment variables. Copy `.env.example` to `.env` and adjust.

### Required

| Variable          | Description                                                                                                                               | Default             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `NEXTAUTH_URL`    | Full URL where the app is hosted (e.g. `http://localhost:3000`)                                                                           | _(none — must set)_ |
| `NEXTAUTH_SECRET` | Random secret for session encryption. `openssl rand -base64 32`                                                                           | _(none — must set)_ |
| `AUTH_TRUST_HOST` | Trust the `X-Forwarded-Host` header (set `true` behind a reverse proxy)                                                                   | `true`              |
| `CRON_SECRET`     | Secret token for authenticating cron/health API calls. Required in production — startup fails without it                                  | _(none — must set)_ |
| `ENCRYPTION_KEY`  | 32-byte base64 key for AES-256-GCM encryption of integration credentials at rest. Required in production; **not required in `DEMO_ONLY`** | _(none — must set)_ |

### Optional — database

| Variable       | Description                                                                                    | Default           |
| -------------- | ---------------------------------------------------------------------------------------------- | ----------------- |
| `DATABASE_URL` | PostgreSQL connection string (e.g. `postgresql://user:pass@host:5432/ledgr`). Omit for SQLite. | _(none — SQLite)_ |
| `SQLITE_PATH`  | Path to the SQLite database file (used only when `DATABASE_URL` is unset)                      | `data/ledgr.db`   |

### Optional — authentication

| Variable                | Description                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `ALLOW_DEV_MODE`        | Set `true` to enable dev-mode login (type any name to log in; no Authentik needed) |
| `AUTH_AUTHENTIK_ISSUER` | Authentik OIDC issuer URL (e.g. `https://auth.example.com/application/o/ledgr`)    |
| `AUTH_AUTHENTIK_ID`     | Authentik OIDC client ID                                                           |
| `AUTH_AUTHENTIK_SECRET` | Authentik OIDC client secret                                                       |
| `DEMO_ONLY`             | Set `true` for demo-only mode — no login, read-only, with a profile chooser        |
| `ALLOWED_ACTUAL_HOSTS`  | Comma-separated hostnames the Actual Budget client may reach on a private network  |

### Integrations

YNAB, Actual Budget, and SimpleFIN credentials are **not** configured via environment variables. Sign in as an admin and set them up in **Settings → Integrations**. Whatever you enter is encrypted at rest with AES-256-GCM using `ENCRYPTION_KEY` before being stored in `api_connections`.

## Architecture

```
┌──────────────────────────────────────────────┐
│                  Browser                      │
│            (React 19 + Recharts)              │
└──────────────┬───────────────────────────────┘
               │ tRPC (type-safe RPC)
┌──────────────▼───────────────────────────────┐
│                Next.js 16                     │
│           App Router + API Routes             │
│    NextAuth (Authentik OIDC / local admin)    │
├──────────────────────────────────────────────┤
│                tRPC Routers                   │
│     (paycheck, budget, portfolio, …)          │
├──────────────────────────────────────────────┤
│             Drizzle ORM (strict)             │
└──────────────┬───────────────────────────────┘
               │ SQL
┌──────────────▼───────────────────────────────┐
│      SQLite (default) or PostgreSQL 16        │
│      (migrations managed by Drizzle Kit)      │
└──────────────────────────────────────────────┘
```

**Key design decisions:**

- **End-to-end type safety** — TypeScript strict mode from the database schema (Drizzle) through the API (tRPC) to the UI (React).
- **Data-driven design** — Data shapes are the source of truth. Renderers are category-agnostic and read fields to render what's present; display logic lives in data presence, not in call-site decisions.
- **Single source of truth for schema** — `src/lib/db/schema-pg.ts` defines the model; `schema-sqlite.ts` is generated from it. Migrations are squashed to a single baseline on each minor release.
- **Self-hosted** — No external SaaS dependencies. SQLite by default, PostgreSQL supported. Budget-provider sync is optional.

## Development

### Prerequisites

- Node.js 26+
- pnpm (`npm install -g pnpm`)
- PostgreSQL 16+ _(optional — SQLite is used by default)_

### Setup

```bash
pnpm install

cp .env.example .env
# Edit .env — set NEXTAUTH_SECRET and CRON_SECRET; optionally DATABASE_URL for PostgreSQL

pnpm db:migrate
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). On first launch you'll see the onboarding wizard.

### Commands

| Command              | Description                                 |
| -------------------- | ------------------------------------------- |
| `pnpm dev`           | Start the development server                |
| `pnpm build`         | Production build                            |
| `pnpm start`         | Start the production server                 |
| `pnpm test`          | Run all tests                               |
| `pnpm test:watch`    | Run tests in watch mode                     |
| `pnpm test:e2e`      | End-to-end browser tests (Playwright)       |
| `pnpm test:coverage` | Run with coverage thresholds                |
| `pnpm lint`          | ESLint + Prettier check                     |
| `pnpm format`        | Auto-format with Prettier                   |
| `pnpm db:generate`   | Generate a migration from schema changes    |
| `pnpm db:migrate`    | Run pending migrations                      |
| `pnpm db:studio`     | Open Drizzle Studio (visual DB browser)     |
| `pnpm backup:export` | Export all data to JSON (stdout or `--out`) |
| `pnpm backup:import` | Import a JSON backup (supports `--dry-run`) |

After editing `schema-pg.ts`, regenerate the SQLite schema with `npx tsx scripts/gen-sqlite-schema.ts` — never edit `schema-sqlite.ts` by hand.

### Authentication modes

| Mode               | When                                              | How                                                                                          |
| ------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Local Admin**    | Always available                                  | Email/password against a `local_admins` table. The first admin is created during onboarding. |
| **Authentik OIDC** | `AUTH_AUTHENTIK_ISSUER` is set                    | SSO with RBAC group mapping. Shown alongside the local-admin form.                           |
| **Dev Mode**       | `ALLOW_DEV_MODE=true` and no Authentik configured | Type any name to auto-login as admin. Local development only — never in production.          |

## Deployment

### Docker (production)

The included `Dockerfile` is a multi-stage build producing a minimal image:

1. **deps** — `pnpm install --frozen-lockfile`
2. **builder** — Next.js standalone build
3. **runner** — minimal Alpine image with only the standalone build, migrations, and a non-root `nextjs` user

`docker-entrypoint.sh` runs pending migrations before starting the server.

```bash
docker compose up -d --build
docker compose logs -f ledgr
docker compose restart ledgr
```

**Production notes:**

- Listens on port **3000** by default.
- Built-in healthcheck hits `/api/health` every 30 seconds.
- Memory limit of **1 GB** is set in `docker-compose.yml`.
- For HTTPS, put a reverse proxy (NGINX, Caddy, Traefik, …) in front and set `NEXTAUTH_URL` to your public URL and `AUTH_TRUST_HOST=true`.
- **SQLite mode:** the `ledgr_data` volume persists the database file across restarts. **PostgreSQL mode:** data lives in the external instance.

### Schema migrations

Migrations are managed by Drizzle Kit and squashed to a single baseline (`0000_v<N>_initial_schema`) on each minor release. On upgrade, `db-migrate.ts` detects the applied-vs-journal count mismatch, writes a pre-upgrade JSON backup (tagged with the detected schema era), clears the old journal, and re-applies the squashed schema idempotently. Existing installs upgrade with no data loss.

### Authentik OIDC setup

1. Create an OAuth2/OIDC application in Authentik for Ledgr.
2. Set the redirect URI to `https://your-domain/api/auth/callback/authentik`.
3. Put the client ID and secret into `AUTH_AUTHENTIK_ID` / `AUTH_AUTHENTIK_SECRET`.
4. Set `AUTH_AUTHENTIK_ISSUER` to the issuer URL.

## Integrations

All three are configured from **Settings → Integrations** — there are no credential environment variables. Only one budget provider (YNAB or Actual) can be active at a time; SimpleFIN runs alongside either.

- **YNAB (You Need A Budget)** — Generate a personal access token at [YNAB Developer Settings](https://app.ynab.com/settings/developer), paste it in, and pick a budget. Syncs accounts, categories, monthly summaries, and transactions with delta sync for fast incremental updates. Two-way: category-goal targets and portfolio snapshots can be pushed back.
- **Actual Budget** — Requires a running [Actual Budget HTTP API](https://github.com/jhonderson/actual-http-api) wrapper in front of your Actual server. Enter the server URL, API key, and budget sync ID. Outbound requests to private IP ranges are blocked unless the host is in `ALLOWED_ACTUAL_HOSTS`.
- **SimpleFIN Bridge** — A read-only daily balance pulse. Provide a SimpleFIN access URL; Ledgr records a dated balance snapshot per linked account. No transaction, category, or budget sync.

The integration layer hardens every outbound call: typed error classification, exponential backoff with `Retry-After` support on rate limits, deterministic idempotency keys so retries don't create duplicate transactions, and drift detection after every sync that surfaces broken account mappings in the UI.

## Testing

5,200+ tests across 300+ Vitest files plus 13 Playwright end-to-end specs — covering the financial calculators, retirement benchmarks, server and router logic, UI components, database migrations and backup transforms, theme-token regressions, and full browser flows. CI enforces coverage thresholds of 85% statements / 70% branches / 80% functions / 85% lines, and also runs the lint/type-check, a file-size guard, a tax-parameter freshness check, a migration safety check, and a documentation-freshness check.

```bash
pnpm test          # Run once
pnpm test:watch    # Watch mode
pnpm test:e2e      # End-to-end browser tests (Playwright)
pnpm test:coverage # Run with coverage thresholds
```

## Tech Stack

- [Next.js 16](https://nextjs.org/) — App Router, Turbopack, standalone output
- [React 19](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/) — strict mode
- [tRPC 11](https://trpc.io/) — end-to-end type-safe API
- [Drizzle ORM](https://orm.drizzle.team/) + SQLite / PostgreSQL 16
- [Tailwind CSS 4](https://tailwindcss.com/)
- [Recharts](https://recharts.org/)
- [NextAuth.js](https://next-auth.js.org/) (v5) — Authentik OIDC / local admin
- [Zod 4](https://zod.dev/) — runtime validation
- [Vitest 4](https://vitest.dev/) + [Playwright](https://playwright.dev/) — testing

## Contributing

Contributions are welcome. Please open an issue to discuss before submitting a PR.

## License

[MIT](LICENSE)
