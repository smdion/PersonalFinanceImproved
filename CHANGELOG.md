# Changelog

All notable changes to Ledgr will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.2] - 2026-03-21

### Added

- **Performance tab groups** — split into "By Account" (401k/IRA, HSA, Brokerage) and "Rollup" (Retirement, Portfolio) with helper tooltips
- **Retirement rollup tab** — aggregates all accounts with `parentCategory: "Retirement"` (401k/IRA + HSA + retirement brokerages) with year-level drill-down
- **Rollovers column** — separates internal transfers (e.g., ESPP to brokerage) from actual contributions in the performance table
- **Snapshot selector** — retirement projections can now use any historical portfolio snapshot, not just the latest
- **YTD timeframe** — portfolio chart now has a "YTD" button alongside 3M/6M/1Y/3Y/All
- **Hover comparison line** — hovering on the portfolio chart draws a horizontal reference line to compare values across time
- **Monte Carlo success rate** — withdrawal strategy comparison table now shows a Monte Carlo success rate for each strategy (200 trials)
- **YNAB key update** — connected YNAB integrations can now replace the API key without removing the connection

### Changed

- **YNAB budget pull** — pulling budget amounts from YNAB now uses the category goal target instead of the budgeted amount, so savings goals sync correctly
- **Savings sync direction** — savings sync now pushes monthly contributions from Ledgr to YNAB goal targets (current + next month) instead of pulling balances
- **Integration settings layout** — reorganized into collapsible sections (budget matching, sinking funds, contribution linking, tracking accounts) with a compact dashboard summary; "How syncing works" collapsed by default

### Fixed

- **Rollup contribution mismatch** — Retirement contributions appeared higher than Portfolio when cross-category rollovers were counted as contributions; now tracked separately
- **Portfolio rollup** — annual totals now sum from per-category rows, correctly including HSA distributions and fees
- **Account linking** — all performance rows properly linked to their performance accounts
- **Parent category mismatch** — HSA and ESPP accounts now appear in the Retirement rollup tab
- **IRA account disambiguation** — tracking account dropdowns now correctly distinguish owners (Sean vs Joanna) when accounts share the same performance ID
- **Joint brokerage ownership** — brokerage sub-accounts are now correctly marked as joint (null owner) instead of being assigned to a single person
- **Rollover fee detection** — transfer fees (e.g., UBS rollover fee) are now classified as fees instead of negative contributions

### Security

- **Column name validation** — backup import/restore validates all column names against the schema whitelist, preventing SQL injection via crafted backup files
- Removed database error details from `/api/health` response body
- Bound PostgreSQL port to `127.0.0.1` in `docker-compose.postgres.yml`

### Fixed

- Auto-version naming now uses local date (respects `TZ` env) instead of UTC
- Auto-version dedup check works on both PG and SQLite

### Changed

- **SQLite pragmas** — connections now set `busy_timeout=5000`, `foreign_keys=ON`, and `synchronous=NORMAL` for reliability and concurrency
- SQLite `truncateTables` deletes in reverse FK tier order instead of toggling `PRAGMA foreign_keys`
- `importBackupSqlite` is now wrapped in a transaction for atomicity
- `createVersion` reads + writes are now in a single transaction for point-in-time consistency
- Pinned pnpm version in Dockerfile (`10.32.1`) for reproducible builds

## [0.1.1] - 2026-03-19

### Added

- **Dual database support** — SQLite as zero-config default for self-hosted users, PostgreSQL via `DATABASE_URL` for shared/production deployments
- `DATABASE_URL` as single connection control point (replaces 5 individual `DATABASE_HOST`/`PORT`/`USER`/`PASSWORD`/`NAME` env vars)
- `docker-compose.yml` defaults to SQLite (no database setup required)
- `docker-compose.postgres.yml` for PostgreSQL deployments

### Changed

- Database dialect is now auto-detected from `DATABASE_URL` presence — no manual `DATABASE_PROVIDER` setting needed
- Version restore operations are now wrapped in a transaction for atomicity
- `drizzle.config.ts` uses `DATABASE_URL` connection string

### Fixed

- Automatic daily snapshots were not being created
- Container restarts no longer create duplicate snapshots for the same day
- Authentik users now receive the correct role based on their group membership
- Timestamps now display in the correct timezone regardless of database server settings
- Dark mode: fixed visible dark boxes on the Historical page and other card backgrounds

## [0.1.0] - 2026-03-18

### Features

- 7 withdrawal strategies (Fixed, Forgo-Inflation, Spending Decline, Constant %, Endowment, Vanguard Dynamic, Guyton-Klinger)
- Federal tax engine with 2025/2026 brackets, FICA, Additional Medicare Tax, and LTCG graduated rates
- Social Security taxation using the IRS provisional income formula
- Required Minimum Distribution tracking with SECURE 2.0 age thresholds
- Monte Carlo retirement simulations with correlated returns and percentile bands
- IRMAA cliff detection with 2-year lookback
- Mortgage calculator with amortization, extra payments, refinance chains, and what-if scenarios
- Contribution routing with waterfall, percentage, and spec-based modes (IRS limits enforced)
- Budget dashboard with income/expense tracking and category breakdowns
- Savings goals tracking
- Brokerage account management with performance metrics
- Portfolio allocation and rebalancing views
- Paycheck modeling with pre-tax/post-tax deduction breakdowns
- Side-by-side scenario comparison
- State versioning with snapshot/restore and JSON export/import
- Demo mode with pre-built profiles and read-only access
- ACA subsidy estimator

### Security

- Role-based access via Authentik OIDC with granular permissions
- Local admin login with email/password
- First-run bootstrap grants admin to the initial user
- Isolated demo profiles with read-only access
- Dev mode requires explicit opt-in

### UI/UX

- Dark and light themes
- Responsive dashboard with sidebar navigation
- Recharts-based data visualizations

### Operations

- PostgreSQL with Drizzle ORM and automated migrations
- Audit trail for all admin changes
- Auto-versioning with configurable retention
- Multi-stage Docker build
- Database health check with user-friendly error state
