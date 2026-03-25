# Changelog

All notable changes to Ledgr will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.3.3] - 2026-03-25

### Architecture

- Extracted all business logic from DB transactions and API handlers into 7 pure function modules (`src/lib/pure/`) — performance, contributions, portfolio, tax, historical, projection, profiles
- Added 105 unit tests for pure functions (`tests/pure/`) — run without DB or environment setup
- Refactored 6 routers to use extracted pure functions as thin wrappers over I/O
- Fixed timezone bug in salary temporal resolution (date string parsing vs `new Date()`)
- Moved `computeReturn`, `sumAccounts`, `sumAnnualRows` canonical implementations from performance router to pure module

### Fixed

- Replaced `corepack` with `npm install -g pnpm` in Dockerfile (Node 25 removed corepack)

### ESLint

- Added import boundary rule: pure modules cannot import DB/ORM code or the helpers barrel
- Added `no-console` rule for `src/` (exempts logger, error boundaries, env validation)
- Added `no-restricted-syntax` rule: no direct `ACCOUNT_TYPE_CONFIG[]` access in server/calculators/pure (use helper functions)

### Docs

- Added "Pure Business Logic Boundary" section to CONTRIBUTING.md with enforcement guidelines and module inventory

---

## [0.3.2] - 2026-03-25

### CI/CD

- Added Playwright browser caching — saves ~30-45s per CI run (I1)
- Added Playwright artifact upload on failure for post-mortem debugging (I2)
- Moved `pnpm audit` to non-blocking — quarterly review catches advisories (I3)
- Added Next.js build cache (`.next/cache`) for faster incremental CI builds (M1)
- Added `concurrency` group to cancel superseded CI runs (M2)
- Added `if: success()` guards on non-blocking steps to skip after blocking failures (M4)
- Added `timeout-minutes: 15` to CI and quarterly-review jobs (N1)
- Added Docker build smoke test as non-blocking CI step (N2)
- Moved audit status into CI health summary table
- Fixed quarterly review heredoc bug — variables now expand correctly in GitHub issues (I4)
- Fixed Node version mismatch in quarterly-review workflow (20 → 24) (M3)
- Removed dead `$DOCS_STATUS` variable capture in quarterly-review (M6)
- Fixed dual env source in E2E step — `.env` file now derives from step `env:` block (M5)
- Added Dependabot tracking for Docker base image updates (I5)

### Security

- Removed `unsafe-eval` from Content-Security-Policy `script-src` directive (I7)
- Added `object-src 'none'` and `base-uri 'self'` to CSP (I7)
- Added Cross-Origin headers: COOP `same-origin`, CORP `same-origin`, COEP `require-corp` (N3)
- Set `X-XSS-Protection: 0` — deprecated header previously set to legacy mode (M9)
- Container filesystem now read-only with tmpfs for `/tmp` (I8)
- Dropped all Linux capabilities (`cap_drop: ALL`) and set `no-new-privileges` (I9)
- Bound container port to `127.0.0.1` only — no longer exposed on all interfaces (M8)
- Added CPU limit (`cpus: 1.0`) alongside existing memory limit (M10)
- Added `umask 0077` to entrypoint — SQLite files created as owner-only (I11)
- Split health endpoint: `/api/health` returns simple probe, `/api/health/detailed` requires CRON_SECRET bearer token (M7)
- Applied same hardening to `docker-compose.postgres.yml`

### Docker

- Pinned base image to `node:24.14.0-alpine@sha256:...` for reproducible builds (I5)
- Compiled `db-migrate.ts` to JS via esbuild in builder stage — removed global `tsx` install from production image (I6)
- Added OCI image labels for provenance and traceability (I10)
- Set explicit `--chmod=555` on entrypoint COPY and switched to direct execution (M11)
- Entrypoint now runs `node db-migrate.js` instead of `tsx db-migrate.ts`

### Release & Deploy

- Added `deploy.sh` — automated build, canary deploy (demo first), health verification, rollback support (C1)
- Images now tagged as `ledgr:X.Y.Z` alongside `latest` — previous versions preserved for rollback (I13)
- Deploy script enforces version matches git tag and package.json (I14)
- Demo container deployed and health-checked before prod (canary pattern) (M14)
- Added `--dry-run` mode to release script — validates without committing (M13)
- Added lockfile drift check to release script (N7)
- Switched to atomic `git push --follow-tags` — prevents orphaned commits without tags (I12)
- Tightened CHANGELOG version grep to match section headers only (`^## .*$VERSION`) (M12)

---

## [0.3.1] - 2026-03-25

### Framework

- Migrated to Next.js 16.2.1 (from 15.5.14) with Turbopack bundler
- Migrated to ESLint 9 flat config (from ESLint 8 / `.eslintrc.json`)
- Moved `xlsx` to devDependencies (only used for seed scripts)
- Added pnpm override for `flatted >= 3.4.2` to resolve transitive CVE
- Made `pnpm audit --prod` blocking in CI (zero production vulnerabilities)
- Split instrumentation into Node.js-only dynamic import for Edge Runtime compatibility

### Code Quality

- Fixed side effect inside `setEditMode` state updater (StrictMode double-fire risk)
- Narrowed ESLint `no-restricted-imports` rule to `src/components/**` only — API routes and server components no longer incorrectly blocked
- Added missing dependency arrays to useEffect hooks in confirm-dialog and budget page
- Removed 7 unnecessary `eslint-disable` directives and 6 unused directives from tests
- Fixed all React Compiler lint errors without disabling rules

---

## [0.3.0] - 2026-03-24

### Framework

- Migrated to Next.js 15.5.14 (from 14.2.35) and React 19 (from 18)
- Resolves all Next.js 14 CVEs including CVSS 10.0 React2Shell vulnerability
- Updated eslint-config-next to 15.5.14, @types/react and @types/react-dom to v19
- Moved `serverComponentsExternalPackages` and `outputFileTracingIncludes` out of experimental config (stable in Next.js 15)
- Removed `instrumentationHook` experimental flag (on by default in Next.js 15)

---

## [0.2.1] - 2026-03-24

### Infrastructure

- Migrated to Node.js 24 LTS (from Node 20) across Dockerfile, CI, and dev tooling
- Updated `@types/node` from v20 to v24
- Node 20 reaches EOL April 30, 2026 — this upgrade provides LTS support through April 2028

---

## [0.2.0] - 2026-03-24

### Upgrading from v0.1.x

> If you're running any v0.1.x version, your data migrates automatically.
> A backup is created before any changes are made.

**Docker users:** Pull the new image and restart. Done.
**Self-hosted:** Run `pnpm db:migrate`. Your data is preserved.
**Manual backup:** `pnpm backup:export --out ./backup.json` before upgrading.
**Restoring old backups:** v0.1.x backup files import seamlessly — they are
auto-transformed to the current schema.

### Database Changes

- All 9 migrations squashed into a single clean initial schema — new installs
  get one migration instead of nine
- Cross-version backup import — old backups are automatically transformed
  on import (all 9 v0.1.x schema versions supported)
- Column renames: `api_sync_enabled` to `is_api_sync_enabled`,
  `lt_brokerage_enabled` to `is_lt_brokerage_enabled`

### Added

- **CLI backup tools** — `pnpm backup:export` and `pnpm backup:import`
  for headless environments and scripted workflows (supports `--dry-run`)
- **Upgrade wizard** — after upgrading from v0.1.x, the Versions page
  shows a banner confirming migration success with a link to the auto-backup
- **Pre-upgrade auto-backup** — schema changes automatically save a full
  data snapshot before applying, so you always have a rollback point

---

## What changed between v0.1.0 and v0.2.0

> If you last used Ledgr at v0.1.0, here is everything that changed.
> For commit-level detail, see
> [git history](https://github.com/smdion/PersonalFinanceImproved/commits/main).

### New Pages & Features

- **Contributions page** — standalone household contribution analysis with
  savings rate summary (total/retirement/portfolio), per-person account
  breakdown with utilization bars, employer match analysis, traditional vs
  Roth split, and contribution profile comparison
- **Help & Guide page** — walkthrough of every feature organized by nav
  group (Cash Flow, Wealth, Net Worth, Analysis, System) plus cross-cutting
  topics
- **Raw Data Browser** — admin-only live database table viewer with row
  counts, column metadata, paginated data, and JSON export
- **Assets page** — consolidated breakdown with Cash, Property, Other Assets
  groupings and subtotals (replaced separate summary/detail cards)

### Retirement & Projections

- **Lump-sum injections** — model one-time events (bonus, inheritance,
  windfall, rollover) in any projection year; supports target account
  selection, traditional/Roth tax type, and optional label
- **Per-year contribution profile switching** — change your entire
  contribution structure at a future year (job change, ESPP stop, etc.)
- **Configurable filing status** — MFJ/Single/HOH as explicit retirement
  setting (not silently derived from W-4); affects federal brackets, LTCG,
  IRMAA, Social Security taxation, and NIIT
- **Snapshot selector** — run projections from any historical portfolio
  snapshot, not just the latest
- **Monte Carlo success rates** — withdrawal strategy comparison table now
  shows success rate per strategy (200 trials)
- **LTCG progressive stacking** — capital gains now taxed across 0%/15%/20%
  brackets by stacking gains on top of ordinary income (was flat marginal rate)
- **NIIT (3.8% surtax)** — Net Investment Income Tax on the lesser of net
  investment income or MAGI exceeding $200k/$250k thresholds
- **LTCG brackets in database** — rates versioned by year and filing status
  (no more hardcoded rates)
- **IRMAA brackets in database** — surcharge thresholds versioned by year
  and filing status with 2-year lookback context

### Contributions & Paycheck

- **Prior-year tax contributions** — designate IRA/HSA contributions for the
  prior tax year during the IRS window (Jan 1 - Apr 15); auto-expires when
  the next year's window opens
- **Multiple contribution profiles** — switch profiles from the top bar;
  view without activating
- **Budget-linked profiles** — each budget column links to a contribution
  profile; savings page automatically uses the correct one
- **Active profile switchers** — Budget and Contribution profile selection
  from the ScenarioBar; global activation affects all consuming pages
- **Paycheck profile viewing** — change local view without setting the
  global active profile; visual indicator when viewing a non-active profile

### Budget & Savings

- **Budget mode awareness on savings** — savings page derives active
  contribution profile from budget column link; cross-mode capacity
  comparison strip shows max monthly funding per budget column
- **Budget profile viewing without activation** — click a profile to edit
  it without making it globally active; explicit "activate" action in hover
  menu

### Portfolio & Performance

- **Performance tab groups** — split into "By Account" (401k/IRA, HSA,
  Brokerage) and "Rollup" (Retirement, Portfolio) with helper tooltips
- **Rollovers column** — separates internal transfers (e.g., ESPP to
  brokerage) from actual contributions in the performance table
- **YTD timeframe** — portfolio chart now has a "YTD" button alongside
  3M/6M/1Y/3Y/All
- **Hover comparison line** — hovering on the portfolio chart draws a
  horizontal reference line to compare values across time

### Integration & Sync

- **YNAB key update** — connected YNAB integrations can now replace the
  API key without removing the connection
- **YNAB budget pull** — now uses category goal target instead of budgeted
  amount; savings goals sync correctly
- **Savings sync direction** — pushes monthly contributions from Ledgr to
  YNAB goal targets (current + next month) instead of pulling balances
- **Savings goal balances** — API-linked goals pull balance from YNAB
  category cache instead of stale internal table

### Self-Hosting & Operations

- **Dual database support** — SQLite as zero-config default, PostgreSQL
  via DATABASE_URL (auto-detected, no manual config needed)
- **docker-compose.yml** defaults to SQLite (no database setup required)
- **docker-compose.postgres.yml** for PostgreSQL deployments
- **Release automation** — `pnpm release X.Y.Z` handles version bump,
  tests, lint, tag, push, and GitHub release creation
- **Tax parameter freshness** — automated system tracking 13 tax parameter
  sets with expiration warnings and IRS source citations

### UI/UX Improvements

- **Sidebar redesign** — reorganized from Income/Investments/Property/
  Planning/System to Cash Flow/Wealth/Net Worth/Analysis/System; Help link
  in footer; DataFreshness tooltip
- **Theme support** — semantic design tokens throughout (no more hardcoded
  color classes)
- **GK spending strategy layout** — Guyton-Klinger guardrail parameters
  now render in paired groups using data-driven metadata

### Testing & CI

- **2,300+ unit/integration tests** — comprehensive test suite covering
  calculators (88% statement coverage), all tRPC routers, helpers, and
  backup transforms
- **26 E2E tests** — Playwright (Chromium) smoke tests for all dashboard
  pages, navigation, settings, sync flows, and health endpoint
- **CI pipeline hardened** — type-check, lint, file-size check, build,
  Vitest with coverage thresholds (85% statements, 70% branches), and
  E2E tests all run as blocking steps on every PR
- **SQLite E2E in CI** — E2E tests run against a standalone Next.js
  server with SQLite (not Postgres), validating the zero-config deployment
  path end-to-end
- **Coverage thresholds enforced** — `pnpm test:coverage` fails if
  statements < 85%, branches < 70%, functions < 80%, or lines < 85%
- **Non-blocking health checks** — migration freshness, docs freshness,
  and dependency audit tracked in CI summary without failing the build
- **Dependabot auto-merge** — minor/patch dependency updates auto-merge
  after CI passes; major updates require manual review
- **Quarterly review workflow** — scheduled GitHub Action for periodic
  dependency and maintenance audits

### Security

- **Column name validation** — backup import/restore validates all column
  names against schema whitelist, preventing SQL injection via crafted files
- Removed database error details from `/api/health` response body
- Bound PostgreSQL port to `127.0.0.1` in docker-compose
- **Rate limiting** — Monte Carlo and syncAll procedures limited to 5
  req/min per user
- **Password complexity** — local admin passwords require uppercase + digit

### Bug Fixes (notable)

- Fixed LTCG bracket stacking (was flat rate, now progressive)
- Fixed contribution override double-inflation on profile switches
- Fixed ESPP/account persistence after contribution profile override
- Fixed overflow routing fallback (routes to joint brokerage when no
  person-specific specs exist)
- Fixed rollup contribution mismatch when cross-category rollovers were
  counted as contributions
- Fixed emergency fund self-loan calculation
- Auto-version dedup check works on both PG and SQLite
- Timestamps display in correct timezone regardless of DB server settings
- Authentik users receive correct role based on group membership

---

## [0.1.0] - 2026-03-18

Initial release.

- 7 withdrawal strategies (Fixed, Forgo-Inflation, Spending Decline,
  Constant %, Endowment, Vanguard Dynamic, Guyton-Klinger)
- Federal tax engine with 2025/2026 brackets, FICA, Additional Medicare Tax
- Social Security taxation using the IRS provisional income formula
- Required Minimum Distribution tracking with SECURE 2.0 age thresholds
- Monte Carlo retirement simulations with correlated returns and percentile bands
- IRMAA cliff detection with 2-year lookback
- Mortgage calculator with amortization, extra payments, refinance chains,
  and what-if scenarios
- Contribution routing with waterfall, percentage, and spec-based modes
  (IRS limits enforced)
- Budget dashboard with income/expense tracking and category breakdowns
- Savings goals tracking
- Brokerage account management with performance metrics
- Portfolio allocation and rebalancing views
- Paycheck modeling with pre-tax/post-tax deduction breakdowns
- Side-by-side scenario comparison
- State versioning with snapshot/restore and JSON export/import
- Demo mode with pre-built profiles and read-only access
- ACA subsidy estimator
- Role-based access via Authentik OIDC with granular permissions
- Dark and light themes
- PostgreSQL with Drizzle ORM and automated migrations
