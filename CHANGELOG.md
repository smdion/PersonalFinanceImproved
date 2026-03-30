# Changelog

All notable changes to Ledgr will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

# v0.3

## [0.3.22] - 2026-03-29

### Fixed

- Lump sums added for post-retirement years now correctly route to the decumulation engine instead of silently being ignored
- Overrides are now editable — click the pencil icon on any override badge to populate the form for editing

---

## [0.3.21] - 2026-03-29

### Added

- Projection overrides (withdrawal rate changes, routing mode, account caps, Roth conversion targets, lump sums) now persist to the database — no longer lost on page refresh

---

## [0.3.20] - 2026-03-29

### Improved

- Restructured retirement page: spending strategy, budget, and withdrawal rate are now grouped together in a "Decumulation Plan" section instead of scattered across the page
- Budget and withdrawal rate controls are visually dimmed with an explanation when the selected strategy doesn't use them (e.g., RMD-Based computes spending from portfolio, not budget)
- Withdrawal Rate label changes contextually: "Initial Withdrawal Rate" for dynamic strategies, "Withdrawal Rate" for fixed
- Withdrawal-related labels across 6 locations now explain how dynamic strategies override the base rate
- Fixed 148 instances of missing spaces between variables and text across 32 files

### Added

- "Quick Look" stats panel on the Portfolio page — toggle button reveals all-time high, distance from ATH, YTD and 52-week change, biggest gain/loss, current streak, average change, best/worst month, volatility, and all-time growth

---

## [0.3.19] - 2026-03-29

### Added

- "Gap" column in Snapshot History showing days since the previous snapshot — provides context when sorting by Change or Change %

---

## [0.3.18] - 2026-03-29

### Fixed

- Snapshot History sorting and change calculations now work across all data, not just the current page — sorting by Change or Change % produces correct global results
- First snapshot on each page no longer shows "—" for Change — delta is computed against the chronologically previous snapshot regardless of pagination

---

## [0.3.17] - 2026-03-29

### Added

- Sortable "Change %" column in Snapshot History showing week-over-week percentage change with color-coded positive/negative values

---

## [0.3.16] - 2026-03-29

### Fixed

- Corrected Social Security amounts in recently-retired demo profile from $3,500/$1,800 to $2,000/$2,000 per month

---

## [0.3.15] - 2026-03-29

### Fixed

- RMD-based spending strategy now uses the primary person's actual age for the IRS factor lookup instead of the household average — eliminates a gap year with $0 withdrawals in multi-person households

---

## [0.3.14] - 2026-03-28

### Added

- Staggered retirement ages: each spouse can retire at a different age — the still-working spouse continues contributing while the retired spouse's contributions automatically stop
- Household transitions to full decumulation only when the last person retires

---

## [0.3.13] - 2026-03-28

### Fixed

- IRMAA Medicare surcharge now correctly applies per-person — when both spouses are 65+, each pays their own surcharge instead of charging only once

---

## [0.3.12] - 2026-03-28

### Added

- RMDs are now computed per-person based on each spouse's birth year and individual Traditional account balances
- James (born 1959) starts RMDs at age 73; Patricia (born 1961) starts at age 75 — each correctly follows SECURE 2.0 rules
- Per-person RMD breakdown available in engine output for tooltip display

---

## [0.3.11] - 2026-03-28

### Fixed

- "Nest Egg at Retirement" now shows current portfolio value for already-retired users instead of $0
- Sustainable withdrawal amount now correctly uses current balance when already retired

### Added

- Social Security income is now modeled per-person — each spouse's SS kicks in at their own claiming age instead of using only the primary person's values
- Withdrawal tooltips show per-person SS breakdown (e.g., "James: $42,000, Patricia: $21,600")

---

## [0.3.10] - 2026-03-28

### Improved

- Retirement table rows now highlight the year Social Security begins (teal) and when RMDs start (amber)
- Hovering over withdrawal amounts shows SS income and RMD context directly in the table tooltip

---

## [0.3.9] - 2026-03-28

### Improved

- Retirement projection chart now explains why withdrawal amounts change at key ages — tooltip shows when Social Security begins and when RMDs kick in
- Dashed reference lines on the chart mark Social Security and RMD start ages for at-a-glance context
- "Recently Retired" demo profile now shows a realistic mix of account types (401k, 403b, IRA, Roth, brokerage) instead of IRAs only

---

## [0.3.8] - 2026-03-27

### Added

- New "Recently Retired" demo profile — a couple in their late 60s with $5M portfolio, RMD-based withdrawals, and Social Security delayed to age 70
- Automated tax parameter staleness check in CI — flags outdated seed data after IRS publication dates
- Backup round-trip integration test — validates data survives the full export → import cycle without loss

---

## [0.3.7] - 2026-03-26

### Fixed

- Expense chart and table showed wildly incorrect actual spending amounts (values were 1,000× too small due to a double unit conversion)
- Expense budgeted column now uses the same YNAB data source as actuals — budget-vs-actual comparisons are apples-to-apples
- Year-over-year comparison no longer shows $0 for the prior year — transaction sync now fetches enough history
- Credit card payment transfers no longer appear as spending in the expense breakdown
- Chart tooltip no longer labels both bars as "Actual" — budgeted and actual are now correctly distinguished
- YNAB system categories (Split, Inflow, Uncategorized) no longer inflate expense totals in the year-over-year table

---

## [0.3.6] - 2026-03-26

### Security

- Hardened admin test runner against shell injection
- Health detail endpoint no longer reveals whether authentication is configured — all auth failures return the same response

### Fixed

- Savings goals with a parent can no longer reference a non-existent goal (database constraint added)
- Financial amount fields now reject invalid values like "NaN" or empty strings on save

### Improved

- Keyboard users can skip directly to page content without tabbing through the sidebar
- Focus stays trapped inside slide panels and confirmation dialogs — Tab no longer escapes to background content
- Screen readers now announce which input has an error and read the error message
- Sortable table columns announce their current sort direction to screen readers

---

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

> What changed since v0.2.0. For patch-level detail, see the entries above.

### Security

- Upgraded to Next.js 15 and React 19, resolving all known Next.js 14 CVEs including a critical (CVSS 10.0) remote code execution vulnerability

### Improved

- Upgraded to Node.js 24 LTS — extends support through April 2028

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
