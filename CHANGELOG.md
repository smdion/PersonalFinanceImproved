# Changelog

All notable changes to Ledgr will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

# v0.3

## [0.3.5] - 2026-03-25

### Fixed

- Corrected 5 incorrect 2025 IRS contribution limits that were using 2026 values:
  - 401k employee limit: $24,500 → $23,500
  - 401k catch-up limit: $8,000 → $7,500
  - IRA limit: $7,500 → $7,000
  - HSA family limit: $8,750 → $8,550
  - HSA individual limit: $4,400 → $4,300

### Improved

- Split large projection page into smaller, faster-loading sections
- All CI checks now block merges — dependency audit, migration check, and docs freshness were previously advisory-only
- Hardened CI pipeline against supply chain attacks (pinned all dependencies to exact versions)
- Added 400+ new tests (2,700+ total) covering budget API integrations, financial calculations, and database compatibility

---

## [0.3.4] - 2026-03-25

### Fixed

- Fixed visual glitch where card borders appeared as harsh white/black lines — borders now use softer, theme-aware colors in both light and dark mode
- Fixed a bug where clicking a budget profile could trigger two actions at once (nested button hydration error)
- Fixed 6 cases where list items (savings goals, projections, upcoming goals) could flicker or reorder incorrectly due to unstable keys

### Improved

- Upgraded internal routing to Next.js 16 conventions (no user-facing changes)

---

## [0.3.3] - 2026-03-25

### Improved

- Faster calculations across performance, contributions, portfolio, tax, historical, and projection pages — core math extracted into optimized modules
- Fixed a timezone bug that could show salary changes on the wrong date

### Fixed

- Fixed Docker build failure on Node.js 25 (replaced removed `corepack` with direct pnpm install)

---

## [0.3.2] - 2026-03-25

### Security

- Tightened Content Security Policy — removed unsafe script evaluation, added object/base-uri restrictions
- Added Cross-Origin isolation headers for stronger browser-side protection
- Container now runs with read-only filesystem, no Linux capabilities, and owner-only file permissions
- Health endpoint split: basic probe at `/api/health`, detailed diagnostics require authentication

### Improved

- Docker image now uses a pinned, reproducible base image with OCI provenance labels
- Production image is smaller — removed TypeScript compiler from runtime
- New deploy script with canary pattern: demo container is health-checked before production rolls over
- Rollback support: previous image versions are preserved as `ledgr:X.Y.Z` tags
- CI runs ~45 seconds faster with browser and build caching
- Stale CI runs are automatically cancelled when new commits are pushed

---

## [0.3.1] - 2026-03-25

### Improved

- Upgraded to Next.js 16 with Turbopack for faster development builds
- Resolved a transitive dependency vulnerability (flatted CVE)
- Zero production vulnerabilities enforced in CI

### Fixed

- Fixed a bug where editing settings could trigger side effects twice in development mode
- Fixed incorrect import restrictions that blocked valid server-side code

---

## [0.3.0] - 2026-03-24

> What changed since v0.2.0.

### Security

- Upgraded to Next.js 15 and React 19, resolving all known Next.js 14 CVEs including a critical (CVSS 10.0) remote code execution vulnerability

---

# v0.2

## [0.2.1] - 2026-03-24

### Improved

- Upgraded to Node.js 24 LTS (from Node 20) — extends support through April 2028

---

## [0.2.0] - 2026-03-24

> Everything that changed since v0.1.0. For patch-level detail, see the
> v0.2.1 entry above.

### Upgrading from v0.1.x

**Docker users:** Pull the new image and restart — data migrates automatically.
**Self-hosted:** Run `pnpm db:migrate`. Your data is preserved.
**Restoring old backups:** v0.1.x backup files import seamlessly — they are
auto-transformed to the current schema.

### New Pages & Features

- **Contributions page** — household contribution analysis with savings rate summary, per-person account breakdown, employer match analysis, traditional vs Roth split, and contribution profile comparison
- **Help & Guide page** — walkthrough of every feature organized by section
- **Raw Data Browser** — admin-only live database table viewer with row counts, column metadata, paginated data, and JSON export
- **Assets page** — consolidated breakdown with Cash, Property, Other Assets groupings and subtotals

### Retirement & Projections

- **Lump-sum injections** — model one-time events (bonus, inheritance, windfall, rollover) in any projection year
- **Per-year contribution profile switching** — change your contribution structure at a future year (job change, ESPP stop, etc.)
- **Configurable filing status** — MFJ/Single/HOH as explicit retirement setting; affects federal brackets, LTCG, IRMAA, Social Security, and NIIT
- **Snapshot selector** — run projections from any historical portfolio snapshot, not just the latest
- **Monte Carlo success rates** — withdrawal strategy comparison table now shows success rate per strategy
- **LTCG progressive stacking** — capital gains now taxed across 0%/15%/20% brackets by stacking on top of ordinary income (was flat rate)
- **NIIT surtax** — Net Investment Income Tax on income exceeding $200k/$250k thresholds
- **LTCG and IRMAA brackets in database** — rates versioned by year and filing status (no more hardcoded values)

### Contributions & Paycheck

- **Prior-year tax contributions** — designate IRA/HSA contributions for the prior tax year during the IRS window (Jan 1 - Apr 15)
- **Multiple contribution profiles** — switch profiles from the top bar; view without activating
- **Budget-linked profiles** — each budget column links to a contribution profile; savings page uses the correct one automatically

### Budget & Savings

- **Budget mode awareness on savings** — savings page derives contribution profile from budget column link; cross-mode capacity comparison shows max monthly funding per budget column

### Portfolio & Performance

- **Performance tab groups** — split into "By Account" and "Rollup" views
- **Rollovers column** — separates internal transfers from actual contributions in the performance table
- **YTD timeframe** — portfolio chart now has a "YTD" button
- **Hover comparison line** — horizontal reference line on portfolio chart

### Integration & Sync

- **YNAB key update** — replace API key without removing the connection
- **Savings sync** — pushes monthly contributions from Ledgr to YNAB goal targets instead of pulling balances

### Self-Hosting & Operations

- **Dual database support** — SQLite (zero-config default) or PostgreSQL
- **CLI backup tools** — `pnpm backup:export` and `pnpm backup:import` for headless environments
- **Pre-upgrade auto-backup** — automatic snapshot before schema changes
- **Cross-version backup import** — old v0.1.x backups auto-transform on import
- All 9 migrations squashed into a single clean schema — new installs get one migration instead of nine
- Release automation via `pnpm release X.Y.Z`
- Node.js 24 LTS — extended support through April 2028

### UI/UX

- **Sidebar redesign** — reorganized into Cash Flow / Wealth / Net Worth / Analysis / System
- **Theme support** — semantic design tokens throughout

### Security

- Column name validation on backup import prevents SQL injection via crafted files
- Rate limiting on Monte Carlo and sync endpoints (5 req/min)
- Password complexity enforced for local admin accounts
- Database error details removed from health endpoint; PostgreSQL port bound to localhost

### Testing & CI

- 2,300+ tests covering calculators, tRPC routers, helpers, and backup transforms
- 26 E2E Playwright smoke tests for all dashboard pages
- Coverage thresholds enforced (statements 85%, branches 70%, functions 80%, lines 85%)
- Dependabot auto-merge for minor/patch updates after CI passes

### Bug Fixes

- Fixed LTCG bracket stacking (was flat rate, now progressive)
- Fixed contribution override double-inflation on profile switches
- Fixed ESPP/account persistence after contribution profile override
- Fixed overflow routing fallback for joint brokerage
- Fixed rollup contribution mismatch with cross-category rollovers
- Fixed emergency fund self-loan calculation
- Fixed timezone display for database timestamps

---

# v0.1

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
