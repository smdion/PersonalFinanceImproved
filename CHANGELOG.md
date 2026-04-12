# Changelog

All notable changes to Ledgr will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

# v0.4

## [0.4.21] - 2026-04-12

### Added

- IRS limit utilization bars, funding percentages, savings rates, and "% to max" recommendations now react to the View toggle (Current Salary / Year-End Estimate / Actual YTD) — previously only summary dollar totals changed
- Contribution dollar amounts shown per account type now reflect the active view: Year-End Estimate shows salary-timeline-weighted totals accounting for mid-year raises, Actual YTD shows real performance data
- Opus advisor subagent (`.claude/subagents/advisor.md`) and project-level working-style guide (`CLAUDE.md`) for structured code review before committing

### Fixed

- Contribution blended estimates no longer double-count when multiple contribution accounts share a single performance account — YTD actuals are split proportionally by expected contribution using salary-timeline-aware weights
- Employer match in `total_contributions` performance data is now correctly subtracted out so employee-only YTD amounts aren't inflated by the match
- Year-End Estimate accounts for stale performance data by filling only the exact missing payroll periods (computed from `performance_last_updated` date and pay schedule) at the current projected rate, rather than replacing or ignoring the actuals
- Monthly and annual contributions (IRA, etc.) are no longer flagged as stale when biweekly paydays pass — stale-gap fill only applies to payroll-cadence contributions
- Contribution method cadence (monthly vs biweekly vs annual) is now used for the blended remaining-fraction calculation, so monthly IRA contributions don't show false shortfalls against biweekly period counts
- Over-limit "Over" badge and red bar no longer trigger from sub-cent rounding noise (0.5% tolerance via centralized `OVER_LIMIT_THRESHOLD` constant)
- "Over by" amount for HSA and other match-counts-toward-limit accounts now correctly uses total contribution (employee + match), not just employee contribution
- Portfolio employer match (ESPP discount) in YTD view is now correctly attributed to portfolio totals instead of being lumped into retirement match
- Mortgage current-balance detection no longer reads system time independently mid-request
- Savings rate card group breakdown (retirement vs taxable) now uses view-aware totals instead of projected-only calculator rates

### Security

- Projection page write operations now require the scenario permission instead of accepting any signed-in user

### Changed

- Blended contribution math consolidated server-side into two pure helpers (`computeViewAwareAccountMetrics`, `computeViewAwareTotals`), eliminating ~200 lines of duplicated client-side blending logic across 4 components
- Blended savings rate uses salary-timeline-weighted total compensation as denominator, correctly reflecting mid-year salary changes
- Inline string-equality and number-formatting violations collapsed onto shared config helpers and formatters
- Inflation-rate fallback defined once in shared constants instead of duplicated across three pages
- Savings transaction amounts use the shared decimal validator

---

## [0.4.20] - 2026-04-11

### Changed

- Tightened internal data invariants so missing or orphan rows now surface as clear errors instead of silently substituting placeholder values like "Unknown" or zero — bad data is caught early instead of producing wrong-but-quiet numbers downstream
- Historical net-worth records backfilled with correct portfolio tax-location breakdowns from existing legacy columns

### Fixed

- Eliminated several silent fallbacks across the performance, snapshot, and demo flows where missing performance-account links or owner records would default to placeholder text instead of being treated as a real error

---

## [0.4.19] - 2026-04-11

### Fixed

- New portfolio snapshots now post one summed adjustment per YNAB tracking-account group instead of a separate transaction per mapping — totals match Ledgr's view of each tracking account
- YNAB sync now matches Ledgr accounts by ID instead of by display label, so duplicate or renamed labels no longer cause missing or doubled adjustments

### Added

- Resync button on every snapshot row in the Portfolio history table — re-pushes that snapshot to YNAB by removing its previous tagged adjustments and posting fresh ones against the live tracking-account balances
- Resyncing a non-latest snapshot prompts a confirmation warning, since later snapshot adjustments were computed against the old state

### Improved

- Snapshot-to-YNAB adjustments now carry a `snapshot:{id}` memo tag and contributor account names, so each YNAB entry is traceable back to the originating Ledgr snapshot
- If a sync fails partway through, any adjustments already posted are rolled back automatically; if rollback can't complete, the failing transaction IDs are surfaced for manual reconciliation

### Security

- Bumped Next.js to 16.2.3 to patch a high-severity Server Components Denial of Service advisory ([GHSA-q4gf-8mx6-v5v3](https://github.com/advisories/GHSA-q4gf-8mx6-v5v3))

---

## [0.4.18] - 2026-04-06

### Improved

- Year-End Estimate mode now uses actual YTD contributions from performance data instead of projecting from current rates — shows what was really contributed plus projected remaining
- IRS limit tracking in Year-End Estimate mode reflects actual contributions for accurate "room remaining" calculations
- Contributions page and dashboard cards in Year-End Estimate mode show actual + projected breakdown

---

## [0.4.17] - 2026-04-06

### New

- Three-mode paycheck view: "Current Salary" (forward planning at current rate), "Year-End Estimate" (blended annual using actual salary changes throughout the year), and "Actual YTD" (elapsed periods only)
- Year-End Estimate mode walks each pay period at its effective salary rate, correctly handling SS cap transitions and percent-of-salary contribution changes across mid-year raises

---

## [0.4.16] - 2026-04-06

### New

- Update Performance form — batch-edit current-year flow data (contributions, employer match, distributions, fees) from a single form with auto-calculated gain/loss
- Lifetime field cascade — editing account data on finalized years now recomputes lifetime totals through all subsequent years

### Improved

- Numeric defaults (withdrawal rate, return rate, high income threshold) extracted to shared constants — no more scattered magic numbers
- Financial amount inputs on performance mutations validated with zDecimal (rejects non-numeric strings)
- Account type fields validated against config enum everywhere (previously accepted arbitrary strings on some mutations)
- Projection overrides permission aligned — brokerage permission now sufficient (was incorrectly admin-only)
- Demo mode blocks data import/export API routes (previously bypassed tRPC demo guard)
- Time resolution: buildYearEndHistory and retirement router use passed-in dates instead of independent new Date() calls
- 17 hardcoded parentCategory checks replaced with isRetirementParent/isPortfolioParent predicates
- 11 hardcoded tax type checks replaced with isPreTaxType/isRothType predicates
- Performance category display order centralized in config (tabs and finalize modal now share one definition)
- Form account type defaults driven from config instead of hardcoded "401k"
- IRMAA age threshold extracted to MEDICARE_START_AGE config constant
- 30+ inline percent formatters replaced with formatPercent(); compact currency formatters unified

---

## [0.4.15] - 2026-04-06

### New

- Chart X-axis toggle — switch between Year and Age on both Net Worth Over Time and Journey to Abundance charts

### Improved

- Health stats show trajectory context when current year is selected: Wealth Score, AAW Score, and FI Progress display "was X at year-end YYYY" reference from the most recent finalized year
- Projected FI Year uses finalized data as primary projection when current year is involved, with YTD shown as secondary context
- FI Card on card view follows same finalized-primary pattern for consistency

---

## [0.4.14] - 2026-04-06

### New

- Spreadsheet view for Trends page — dense year-over-year comparison table, financial health stats, tax location breakdown, and net worth location. Toggle between card and spreadsheet layouts
- Projected FI Year — linear extrapolation of when financial independence will be reached, with prior-year reference when current year shows "Progress Stalled"
- Retirement parent category rollup rows show combined retirement account totals alongside per-account-type detail
- Year-over-year comparison with Projected Year / Actual YTD toggle — contributions are prorated for meaningful comparisons, gains/losses shown as-is (market-driven)
- Prorated values marked with asterisk and footnote for transparency

### Improved

- All wealth metrics (Wealth Score, AAW Score, FI Progress) now computed once in buildYearEndHistory — single computation path eliminates inconsistencies across pages
- Wealth Score changed to net worth / lifetime earnings (savings efficiency percentage)
- AAW Score uses Money Guy formula with average household age and Combined AGI
- Market value / cost basis toggle now affects all metrics: YoY table, health stats, net worth location, pie charts, and Journey to Abundance benchmarks
- Salary averaging toggle impacts all consumers including Journey to Abundance benchmark lines
- Journey to Abundance chart benchmark lines use same age-adjusted formula as AAW score
- Tax location data from finalized JSONB column (point-in-time capture at year-end) instead of config-based derivation
- Home value cost basis correctly computed from cumulative improvement items instead of broken per-year DB column
- Current year gross income includes bonus via getTotalCompensation
- FI Progress on dashboard now includes cash (consistent with Trends page)
- Zebra striping on all spreadsheet tables for readability

### Fixed

- computeFIProgress was excluding cash from the calculation
- Tax location keys normalized to camelCase (was mixing snake_case and camelCase producing duplicate rows)
- Wealth score labels unified across MetricsRow and Financial Checkup via shared wealthScoreTier helper

### Changed

- calculateNetWorth inputs: age replaced with averageAge, annualSalary replaced with effectiveIncome, added lifetimeEarnings
- Net worth calculator produces dual market/cost basis scores for wealth and AAW metrics
- AAW thresholds updated: PAW >= 2.0, AAW >= 1.0 (was: PAW >= 1.0, AAW >= 0.5 with x2 baked in)
- Schema: added portfolio_by_tax_location JSONB column to net_worth_annual
- Finalization process now captures tax location breakdown at year-end
- buildYearEndHistory is the single source of truth for all year-level financial data

---

## [0.4.13] - 2026-04-03

### New

- Update Performance form — batch-edit all current-year account flow data (contributions, employer match, distributions, rollovers, fees) from a single form instead of clicking individual cells
- Ending balance source toggle: pull from latest portfolio snapshot (default) or enter manually
- Gain/loss auto-calculated live with manual override option

### Improved

- Savings rates now use total compensation (includes bonus) as the denominator across all pages — contributions, dashboard financial checkup, and savings rate card all show consistent rates
- High-income households ($200K+) see employee-only savings rate as the headline, with match rate shown as secondary
- Spending stability chart now shows a dollar Y-axis alongside the percentage axis, with withdrawal and plan amounts in tooltips
- Spending stability baseline uses the strategy's own target (with post-retirement raise) for strategies that track it, and MC-inflated year-1 withdrawal for dynamic strategies
- Monte Carlo fan bands no longer glitch when switching between confidence band ranges

---

## [0.4.12] - 2026-04-01

### New

- Spending stability charts with Monte Carlo confidence bands — Balance, Strategy, and Budget views all show simulated outcome ranges
- Toolbar restructured: chart controls co-located with chart header, table controls co-located with table header, main toolbar reduced to global controls only
- Independent Baseline (On/Off) and Confidence Band (Off/50%/80%/90%) controls across all chart views
- Strategy Analyzer with opt-in "Analyze My Strategy" button running what-if Monte Carlo scenarios

### Improved

- All user-facing jargon renamed: "Det" to "Baseline", "MC Bands" to "Confidence Band", percentile notation to confidence percentages, "MC median" to "Sim. median"
- "Deterministic + MC Simple + MC Advanced" badges simplified to "Baseline + Simulation"
- Strategy param dropdowns now update instantly via optimistic cache updates (previously waited 7-30s for full projection recompute)
- Spending stability chart uses bar chart matching Balance view visual pattern (same colors, opacities, fan band layers)

### Fixed

- Strategy param dropdowns (Base Withdrawal %, Ceiling, Floor, etc.) not persisting — settings return object was missing all strategy param fields, causing dropdowns to always show defaults
- Dollar mode (Today's $/Future $) now syncs correctly between Projection and Strategy Comparison tabs
- Removed dead Deterministic chart tab (Fan Bands selector already provided this functionality)

---

## [0.4.11] - 2026-04-01

### New

- Dual spending stability donuts: "vs Strategy" measures against year-1 withdrawal, "vs Budget" measures against your stated retirement budget — shows whether the strategy covers what you actually need
- Strategy Analyzer: opt-in "Analyze My Strategy" button on the comparison tab runs what-if MC scenarios and shows the top 3 parameter changes that would improve your success rate or spending stability

### Improved

- Both stability columns (strategy + budget) shown in strategy comparison table
- Lever metadata added to strategy config — the analyzer reads paramField.lever to know which knobs to test, no parallel registry
- Budget stability metric added to MC engine: compares withdrawals against user's retirement budget (inflation-adjusted) instead of year-1 withdrawal

---

## [0.4.10] - 2026-04-01

### Improved

- Today's $/Future $ toggle on Strategy Comparison tab, shared with Projection tab — toggling one updates both
- Strategy guide content moved into withdrawal strategy config (data-driven) — guide panel reads the config shape with no per-strategy knowledge
- Removed dead Compact/Expanded table toggle (All Years toggle already provides this)
- Decumulation settings layout further compacted with 2-column strategy param grid

---

## [0.4.9] - 2026-04-01

### Fixed

- Withdrawal engine now correctly skips post-retirement inflation for strategies that don't use it (Vanguard, Const %, Endowment, RMD) — dimmed UI settings no longer silently affect projections
- RMD pre-RMD fallback spending now grows with CPI to maintain purchasing power during the 10–18 year gap before RMD age
- Spending Decline now produces a true real decline (spending grows nominally with CPI minus the decline rate) instead of a steeper nominal decline that over-cut by the full inflation rate
- Guyton-Klinger guardrail parameter grouping corrected — Upper Guardrail now pairs with Increase % (prosperity) and Lower Guardrail with Decrease % (capital preservation)

### Improved

- Endowment rolling window default changed from 10 to 5 years, matching standard university endowment practice (Yale/Stanford use 3–5 years)
- Strategy Guide flyout added to both Projection and Strategy Comparison tabs — explains each strategy's mechanics, strengths, weaknesses, and what to expect from the Stability metric
- Stability column tooltip now explains why budget-based strategies score higher and portfolio-linked strategies naturally score lower
- Decumulation settings layout compacted: Post-Retirement Raise and Withdrawal Rate shown side by side; strategy parameters flow in a 2-column grid
- Timeline and Income sections merged into a single left-column box in Projection Assumptions, reducing whitespace

---

## [0.4.8] - 2026-04-01

### Improved

- Retirement page redesign: removed redundant deterministic stats row and depletion warning banner (info moved to hero card subtitles)
- Three-way chart toggle: Balance | Spending Stability | Deterministic — spending stability shows withdrawal trajectory as % of initial plan with 75% threshold line
- MC assumptions bar relocated from below chart to below hero cards — assumptions before evidence
- Chart view toggle and table compact/expanded toggle in control bar
- Strategy Comparison moved to page-level tab with table and chart shown together (no toggle needed)
- Hero cards standardized: "Funding Outlook" replaced with "End Balance" showing MC median
- Rich tooltips for Success Rate and Spending Stability donuts with threshold explanations and time horizon context
- MC summary bar shows only assumptions (preset, return, volatility, rate, inflation, trials) — no longer duplicates hero card metrics
- Strategy comparison refreshes automatically when MC settings change

---

## [0.4.7] - 2026-03-31

### Improved

- Renamed "Spending Adequacy" to "Spending Stability" — compares withdrawals to the initial year-1 withdrawal (inflation-adjusted) instead of the strategy's own target, properly measuring whether dynamic strategies maintain the planned income level
- Strategy comparison now refreshes when MC settings change (inflation, glide path, asset classes)
- Loading skeleton shown for hero cards while MC simulation runs instead of flashing deterministic cards

---

## [0.4.6] - 2026-03-31

### Improved

- Retirement page now defaults to Monte Carlo view — the Deterministic/Monte Carlo toggle has been removed since MC overlays on top of the deterministic projection with no unique deterministic-only content
- Spending adequacy now visible in the hero success rate card, below the donut

---

## [0.4.5] - 2026-03-31

### Added

- Spending Adequacy metric — shows what percentage of Monte Carlo trials maintained at least 75% of target withdrawals in every retirement year, surfaced alongside success rate in both the MC results summary and strategy comparison table
- Clear tooltips distinguishing success rate (portfolio survives — industry standard) from spending adequacy (income holds up — catches dynamic strategy spending cuts)

### Fixed

- Strategy comparison now uses saved MC inflation overrides instead of hardcoded 2.5% — results match the main retirement page
- Plan Assumptions "Inflation" badge corrected from "Deterministic + MC" to "Deterministic" with updated tooltip explaining that MC uses stochastic inflation from the preset

---

## [0.4.4] - 2026-03-31

### Fixed

- Monte Carlo stochastic inflation now affects post-retirement expense growth — previously only pre-retirement inflation was randomized, leaving decumulation expenses at a fixed rate across all trials
- Restored projection scope badges on retirement page section headers showing which settings affect Deterministic, MC Simple, and MC Advanced modes (removed in v0.3.24)

---

## [0.4.3] - 2026-03-31

### Fixed

- Expense page was counting YNAB savings allocations and reimbursements (positive activity) as spending — only outflows (negative activity) are now included in actual amounts

---

## [0.4.2] - 2026-03-31

### Fixed

- Post-retirement contributions for Portfolio-category accounts now appear in the brokerage page Year-by-Year table — values are computed for display without inflating retirement engine balances
- Clarified parentCategory as the controlling boundary for retirement vs portfolio routing (not account type)

---

## [0.4.1] - 2026-03-30

### Fixed

- Portfolio-category (brokerage) contributions no longer inflate retirement projection balances — post-retirement brokerage contributions are modeled on the brokerage page only, restoring correct Monte Carlo success rates
- Added engine invariant test enforcing category boundary: no brokerage contributions during decumulation years

---

## [0.4.0] - 2026-03-30

> What changed since v0.3.0. For patch-level detail, see the v0.3.x entries below.

### Upgrading from v0.3.x (or earlier)

**Docker users:** Pull the new image and restart — data migrates automatically. A pre-upgrade backup is saved to `/data/pre-upgrade-backup-{timestamp}.json`.
**Self-hosted:** Run `pnpm db:migrate`. Your data is preserved.
**Restoring old backups:** v0.1.x, v0.2.x, and v0.3.x backup files all import seamlessly — they are auto-transformed to the current schema.

All v0.3.x migrations have been squashed into a single initial schema. The migration runner detects the squash automatically and handles the transition.

### Per-Person Retirement Engine

- **Staggered retirement ages** — each spouse can retire at a different age; the still-working spouse continues contributing while the retired spouse stops
- **Per-person Social Security** — each spouse's SS kicks in at their own claiming age with per-person breakdown in tooltips
- **Per-person RMDs** — computed from each spouse's birth year and individual Traditional account balances, following SECURE 2.0 rules
- **Per-person IRMAA** — Medicare surcharge correctly applies to each spouse independently when both are 65+
- RMD-based spending strategy now uses the primary person's actual age for the IRS factor lookup instead of the household average
- Timeline shows "Household Retirement" based on when the last person retires instead of a misleading average

### Brokerage Page Redesign

- **Single-page layout** — Goals section collapsed inline, "Planned Events" replaces separate Transactions tab
- **Detailed tooltips** on all Year-by-Year columns (contribution breakdown, growth, withdrawal tax cost, balance change)
- **Today's $ / Future $ toggle** with inflation-adjusted deflation
- **Budget linking badge** showing which budget item funds each brokerage account
- **YNAB account linking** — link brokerage accounts to YNAB tracking accounts; linked accounts use YNAB as the balance source of truth
- Portfolio snapshot import automatically pulls YNAB balances for linked accounts

### Post-Retirement Brokerage & Contribution Controls

- **Per-account "After retirement" setting** — stop contributions, continue until last person retires, or continue indefinitely
- **Per-account contribution scaling** — scales with salary (default) or fixed amount; prevents fixed-dollar contributions from dropping during staggered retirement
- Post-retirement brokerage contributions grow with limit growth rate (inflation) instead of staying flat

### Cost Basis Tracking

- **Per-account cost basis** on the Performance page Brokerage tab — editable field with computed unrealized gain column

### Override System

- **Wizard-style "Add Override" flow** — pick year, pick what to change, fill 1-3 fields; replaces three dense forms
- **Database persistence** — projection overrides (withdrawal rate, routing mode, account caps, Roth conversion targets, lump sums) survive page refresh
- **Lump sums target specific accounts** with shared form and badge components used by both retirement and brokerage pages
- Lump sums appear in the retirement projection table with In/Out column, contribution columns, and balance tooltips
- Override badges show type context ("Contribution" when from a profile, "Salary" when custom)
- Strategy-aware context banners explain how the active spending strategy interacts with withdrawal routing and overrides

### Portfolio Enhancements

- **Quick Look stats panel** — all-time high, distance from ATH, YTD and 52-week change, biggest gain/loss, current streak, volatility, and all-time growth
- **Change % column** in Snapshot History with color-coded positive/negative values and gap-since-last-snapshot context
- Snapshot History sorting now works across all data, not just the current page

### UI/UX

- Restructured retirement page: spending strategy, budget, and withdrawal rate grouped in a "Decumulation Plan" section
- Withdrawal Routing redesigned with compact collapsed view and sunken expanded panel
- Budget and withdrawal rate controls visually dimmed when the selected strategy doesn't use them
- Fixed 148 instances of missing spacing between variables and text across the app
- Softer, theme-aware card borders in both light and dark mode
- Upgraded to Next.js 16 with Turbopack for faster development builds
- "Recently Retired" demo profile with realistic account mix (401k, 403b, IRA, Roth, brokerage)

### Security & CI

- Hardened admin test runner against shell injection
- Health detail endpoint no longer reveals whether authentication is configured
- All CI checks now block merges — dependency audit, migration check, and docs freshness were previously advisory-only
- Hardened CI pipeline against supply chain attacks (pinned all dependencies to exact versions)
- Keyboard skip-to-content, focus trapping in dialogs, and screen reader error announcements
- Tightened Content Security Policy with Cross-Origin isolation headers
- Container runs with read-only filesystem, no Linux capabilities, and owner-only file permissions
- Docker image uses pinned, reproducible base image with canary deploy pattern

### Self-Hosting & Operations

- All v0.3.x migrations squashed into a single clean schema — new installs get one migration instead of seven
- Pre-upgrade auto-backup handles v0.1.x, v0.2.x, and v0.3.x databases
- Cross-version backup import supports all previous schema versions with auto-transforms
- SQLite squash upgrade support (same seamless upgrade path as PostgreSQL)

### Testing

- 2,750+ tests (up from 2,300+) covering budget API integrations, financial calculations, database compatibility, and backup round-trips
- Automated tax parameter staleness check in CI

### Bug Fixes

- First-year pro-rating now excludes the current month after mid-month
- Expense chart and table showed incorrect actual spending amounts (double unit conversion)
- Year-over-year comparison no longer shows $0 for the prior year
- Credit card payment transfers no longer appear as spending
- Corrected 5 incorrect 2025 IRS contribution limits that were using 2026 values
- Fixed Docker build failure on Node.js 25

---

# v0.3

## [0.3.28] - 2026-03-30

### Added

- Brokerage page redesigned as single-page layout — Goals section collapsed inline, "Planned Events" replaces separate Transactions tab
- Year-by-Year brokerage table now has detailed tooltips on all columns (contribution breakdown, growth, withdrawal tax cost, balance change) using shared retirement tooltip infrastructure
- Today's $ / Future $ toggle on brokerage page with inflation-adjusted deflation
- Editable annual contribution increase control on brokerage Funding Sources card
- Budget linking badge ("Linked to budget: LT Brokerage") on brokerage By Account section
- Per-account "After retirement" setting on Portfolio page: stop contributions, continue until last person retires, or continue indefinitely
- Per-account "Contribution scaling" setting: scales with salary (default) or fixed amount — prevents fixed-dollar contributions from dropping during staggered retirement
- Per-account cost basis on Performance page Brokerage tab — editable field updated alongside other performance data, with computed unrealized gain column
- Brokerage contributions now continue after retirement for accounts set to "Continue indefinitely"

### Fixed

- First-year pro-rating now excludes the current month after mid-month (day > 15) — March 30 shows 9 months remaining, not 10
- Fixed-dollar brokerage contributions no longer drop during staggered retirement when one person retires
- Post-retirement brokerage contributions grow with limit growth rate (inflation) instead of staying flat
- Budget badge matching uses raw category key instead of display label (was never matching)
- YNAB badge matching uses account category instead of missing performanceAccountId
- Contribution account linking dropdown no longer hides budget items that are already linked to API categories
- Planned Events tooltip no longer incorrectly references IRS contribution limits (brokerage has none)
- Renamed `colorKey` to `categoryKey` across contribution summary and all consumers for clarity

---

## [0.3.27] - 2026-03-30

### Added

- Brokerage accounts can now be linked to YNAB tracking accounts — linked accounts use YNAB as the balance source of truth
- New "Account Linking" section on brokerage page with link/unlink controls and YNAB badges
- Portfolio snapshot import automatically pulls YNAB balances for linked accounts before pushing
- New `pullPortfolioFromApi` endpoint updates snapshot balances from YNAB tracking accounts

### Improved

- Extracted shared `getApiAccountBalanceMap()` helper — replaces 4 duplicated inline patterns across admin, sync-mappings, and sync-core routers
- Consolidated brokerage page from 3 tabs to 2: removed "Transactions" tab (planned transactions), renamed "Lump Sum Events" to "Planned Events"
- Planned Events use the shared engine-integrated lump sum system (shared with retirement page) instead of the separate goal-linked transaction system

---

## [0.3.26] - 2026-03-30

### Fixed

- Timeline now shows "Household Retirement: X when last person retires" instead of misleading "Avg Retirement Age" — matches the engine's actual per-person retirement behavior

---

## [0.3.25] - 2026-03-30

### Improved

- Override edit now works: pencil icon opens wizard at step 3 with value pre-filled
- Salary/contribution overrides support "From contribution profile" with profile selector
- Budget overrides support "From budget profile" with profile + column selector
- "Salary Change" renamed to "Contribution / Salary" to reflect full scope
- Override badges show "Contribution" when from a profile, "Salary" when custom

---

## [0.3.24] - 2026-03-30

### Improved

- Redesigned overrides panel: wizard-style "Add Override" flow replaces three dense forms — pick year, pick what to change, fill 1-3 fields
- Saved overrides display as clean scannable cards with year, type badge, and summary
- Withdrawal Routing section redesigned to match: indigo buttons, compact collapsed view, sunken expanded panel
- Strategy-aware context banners explain how the active spending strategy interacts with withdrawal routing and overrides
- Removed verbose "Deterministic + MC" badges from all Projection Assumptions sections — cleaner headers

---

## [0.3.23] - 2026-03-30

### Added

- Lump sums now target specific individual accounts (e.g., "Retirement Brokerage (Vanguard)") instead of account categories
- Shared lump sum form and badge components used by both retirement and brokerage pages
- Brokerage page lump sums now persist to database and support both injections and withdrawals
- Lump sums appear in the retirement projection table: In/Out column (net), contribution columns, and balance tooltips

### Improved

- Override sections renamed from "Saving/Withdrawal" to "Pre-Retirement/Post-Retirement" for clarity

---

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
