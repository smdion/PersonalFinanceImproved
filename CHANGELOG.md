# Changelog

All notable changes to Ledgr will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.4] - 2026-03-22

### Added

- **Per-year contribution profile switching** — salary/contribution overrides can now reference a contribution profile; the engine switches to that profile's full contribution structure (accounts, employer match) from the target year forward instead of only changing the salary dollar amount
- **Future-dollar budget overrides** — budget overrides from a profile are inflation-adjusted to the target year with preview showing today → future breakdown
- **`buildProfileContribData()` helper** — single source of truth for building engine contribution data from any resolved profile, used by both default and switched profiles
- **LTCG brackets in database** — long-term capital gains brackets moved from hardcoded config to a database table with year/filing-status versioning; new Settings tab for editing thresholds and rates by year with copy-from-year support
- **IRMAA tables in database** — IRMAA surcharge brackets moved from hardcoded config to a database table; new Settings tab showing MAGI thresholds, annual surcharges, and monthly equivalents per filing status with 2-year lookback context
- **Contributions page** — standalone household contribution analysis at `/contributions` with savings rate summary (total/retirement/portfolio), per-person account breakdown with utilization bars, employer match analysis, traditional vs Roth split, and contribution profile comparison
- **Raw Data Browser** — admin-only live database table browser at `/data-browser` with table list, row counts, column metadata with type badges, paginated data viewer, JSON cell expansion, and JSON export
- **Tax parameter freshness tests** — automated expiration system that tracks 13 tax parameter sets (federal brackets, LTCG, IRMAA, ACA FPL, RMD, FICA, SS thresholds, SECURE 2.0) with source citations; warns at 1 year stale, fails at 2+ years; includes value verification against known-good IRS data and structural law canaries (TCJA sunset, unindexed thresholds)

### Fixed

- **Salary basis mismatch** — profile switch employer match rates now use total compensation (including bonus) instead of raw base salary, matching the default profile path
- **Contribution override double-inflation** — profile switch salary overrides are grown by the configured raise rate to the switch year and fed through the existing salary override mechanism; no special engine logic needed
- **ESPP/account persistence after override** — switching contribution profile at a future year now stops accounts not in the new profile (e.g. ESPP) instead of keeping the original profile's accounts active
- **Contribution rate ceiling spike at profile switch** — contribution rate ceiling is now recalculated from the switched profile's total contributions instead of using the stale default profile rate, preventing an 11.2% jump in 401k/IRA/HSA when ESPP is removed
- **Overflow routing fallback** — when IRS overflow occurs and no matching brokerage specs exist for a person, overflow now routes to joint/unowned brokerage accounts instead of silently disappearing
- **Brokerage parentCategory filtering** — Retirement page no longer shows Portfolio-parentCategory brokerage (e.g. Long Term Brokerage) in the brokerage column, In/Out totals, or tooltip breakdowns; all columns and tooltips now use the same parentCategory-filtered data source
- **Tooltip/table data consistency** — brokerage column, In/Out column, and tax-type view tooltips now share the same filtered math as their table cells (previously tooltips used raw unfiltered slot data)
- **Brokerage match display** — brokerage column now shows total (employee + match) with `+m` badge, matching 401k/IRA/HSA column behavior
- **Salary tooltip person filter** — salary tooltip now shows person-specific salary and change percentage when a person filter is active, matching the table cell
- **Sidebar test suite** — updated test assertions to match v0.1.3 nav group rename (Income→Cash Flow, Investments→Wealth, Property→Net Worth, Planning→Analysis)

### Improved

- **Contribution ceiling explanation** — methodology panel now explains where the rate comes from, how scaling works, and where to override it
- **Contribution Rate HelpTip** — overrides panel explains auto-derivation from current contributions and proportional scaling behavior
- **Overflow Priority HelpTip** — brokerage contribution accounts now explain overflow routing order and priority numbers

### Changed

- **Tax constants dependency injection** — `getLtcgRate()`, `getIrmaaCost()`, and `getNextIrmaaCliff()` now accept optional DB-loaded brackets, falling back to hardcoded defaults when no DB rows exist
- **Sidebar navigation** — added Contributions to Analysis group and Raw Data to System group

## [0.1.3] - 2026-03-22

### Changed

- **Savings goal balances** — API-linked savings goals now pull their balance from the YNAB category cache instead of the stale internal table
- **YNAB goal target push** — goal targets are now correctly pushed once at the plan level instead of redundantly for current + next month
- **Budget pull** — no longer falls back to YNAB "Assigned" amount when no goal target is set; defaults to $0 instead

### Improved

- **Sidebar navigation restructured** — reorganized from Income/Investments/Property/Planning/System to Cash Flow/Wealth/Net Worth/Analysis/System to match how people think about money; moved Help to a standalone footer link; aligned sign-out styling with other footer items
- **Net Worth page renamed to Trends** — the net worth visualization page is now called "Trends" in the sidebar and page header, reflecting its role as a chart/visualization page within the Net Worth group
- **Assets page UI/UX** — consolidated duplicate summary/detail cards into a single "Asset Breakdown" card with grouped sections (Cash, Property, Other Assets) and subtotals; all-zero years filtered from history table
- **Historical snapshots moved** — removed the "Historical Snapshots" card from the Assets page; this data already lives on the Historical page under the filterable "Assets" column group

### Fixed

- **Emergency fund self-loan** — the YNAB reimbursement category's goal target is now correctly treated as a self-loan (money owed back to the fund) instead of being subtracted from the balance; matches the spreadsheet's Income Replacement Snapshot exactly
- **Duplicate sync button** — removed the redundant "Sync Goals" button on the Savings page that did the same thing as "Push Contributions"
- **Monte Carlo snapshots** — fixed integration test snapshots that were off by one year after calendar rollover

### Added

- **Help & Guide page** — new `/help` page with collapsible sections walking through every feature, organized by nav group (Cash Flow, Wealth, Net Worth, Analysis, System) plus cross-cutting topics (scenarios, contribution profiles, budget API integration, demo mode, tips & shortcuts); accessible from the sidebar footer
- **Calculator logic tests** — 27 unit tests covering FICA base distinction, cross-calculator consistency, bonus placement, Medicare thresholds, SS cap transition, refinance chains, wealth formula, and multi-column budgets

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
