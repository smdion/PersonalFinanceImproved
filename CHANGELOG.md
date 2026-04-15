# Changelog

All notable changes to Ledgr will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

# v0.5

## [0.5.3] - 2026-04-14

Maintenance release. Engine correctness fixes and internal reorganization — no new features.

### Fixed

- **Retirement projections now handle the case where retirement age equals current age.** Previously the projection engine would skip the final partial accumulation year, leaving contributions unapplied for the current year and producing incorrect nest-egg totals.
- **Per-phase retirement budget is now set up before the first projection year runs.** An edge case near the retirement boundary could produce projections that used an uninitialized budget floor for the first year.
- **Mid-year job change: paycheck tax brackets now split correctly at the salary boundary.** Previously, paychecks straddling a mid-year raise could apply the wrong marginal tax rate.
- **HSA funds are now drawn down correctly after retirement.** A gap in the decumulation logic left HSA balances growing unused in post-retirement years instead of being spent.
- **Employer match is now capped at the plan maximum before being counted toward annual totals.** High-contribution scenarios could previously exceed IRS limits via uncapped match.
- **Pension income now reduces the savings floor before the minimum contribution is enforced.** Plans with significant pension income were over-saving to meet a floor that pension income already satisfied.

### Internals (no user-facing changes)

Internal refactors to improve separation of concerns. All changes are pure relocation or extraction — no behavior changes. All 198 engine snapshot tests pass before and after.

**Budget page extractions:**

- `BudgetPageContext` introduced to carry shared state to `BudgetTable` and `BudgetSummaryBar`, eliminating a long prop-drilling chain. Budget content component dropped from 785 to 398 lines.
- `useBudgetPageState` and `useBudgetDerivedData` hooks extracted from budget content, plus `BudgetDetailPanel` split out as a standalone component.

**Contribution accounts extractions:**

- `useContributionAccountsMutations` hook and `UnlinkedContribsBanner` component extracted from `contribution-accounts.tsx` (643→345 lines). All derived Maps are now memoized.

**Portfolio stats extraction:**

- Portfolio quick-look stats derivation extracted as a pure function with 18 new unit tests, making it independently verifiable outside the component tree.

**Correctness micro-fixes (no user-visible effect):** category-totals memoization tightened, visible-categories list stabilized across renders, contribution-by-performance-id map type tightened, integrations per-section hooks unified to a consistent shape, internal mutations type renamed to avoid a collision with an unrelated type.

---

## [0.5.2] - 2026-04-14

Maintenance release. No user-facing features or behavior changes — this is an internal reorganization to keep the codebase reviewable as it grows.

### Changed

- **TypeScript upgraded to 6.0.2** (dev dependency only; no runtime effect). Also picked up minor version bumps for `jsdom`, `prettier`, and `vitest` that were already on `main`.

### Fixed

- **Performance category tabs** — help tooltips now source their labels from the shared label config instead of a local duplicate map. Silent drift only; the displayed labels were already correct via CSS uppercase, but the underlying keys diverged from the canonical constants.
- **Savings contribution grid** — the monthly total cell now uses the shared currency formatter instead of a hand-rolled `.toLocaleString()` string. Same output, but consistent with every other currency cell in the app.

### Internals (no user-facing changes)

Large internal file-split refactor. Every change below is pure relocation, validated byte-identical via the existing engine snapshot parity test (64 inline snapshots for `calculateProjection` output) plus a new `baseEngineInput` snapshot guard. All 3,100 tests pass both before and after the refactor.

**Directory splits with preserved public APIs:**

- Projection router is now a directory (`scenarios.ts`, `monte-carlo.ts`, `strategy.ts`, `stress-test.ts`, `presets.ts`, `_shared.ts`) composed via `mergeRouters(...)`. The top-level `projectionRouter` export is unchanged.
- `projection-year-handlers.ts` (1,983-line engine file) split into 8 focused modules under `projection-year-handlers/` — `types`, `context`, `state`, `pre-year-setup`, `accumulation-year`, `decumulation-year`, `helpers`, and a barrel `index.ts`. Consumer import path (`./projection-year-handlers`) resolves to the same public surface.
- `buildEnginePayload` extracted from the retirement router into a new retirement-scoped module at `server/retirement/build-engine-payload.ts`. The function was only consumed by the projection router's compute endpoints.
- Six `sync-*.ts` router files consolidated into a `sync/` directory, matching the `projection/` and `settings/` layouts.

**Page-level splits (content-component + section sub-components):**

- **Retirement page** split into 9 section components (Social Security, Taxes, Healthcare, Glide Path, Timeline, Income, Strategy Params, Per-Phase Budget, Raise+Rate) with shared prop types. Parent dropped from 2,001 to 673 lines.
- **Budget page** split into an SSR shell (45 lines) + a client content component + 5 section sub-components + 5 per-section mutation hooks + a shared invalidate hook.
- **Integrations preview panel** split into 5 section components (drift banner, budget, savings, contrib, portfolio) with 5 per-section mutation hooks. The per-section hook shape prevents whole-panel re-renders when an unrelated section's mutation fires.
- **Tools / Relocation calculator** split into 6 sub-components with hand-rolled local prop types.
- **Portfolio page** — 4 already-named in-file components extracted to their own files.

**New safety nets:**

- `engine-input-snapshot.test.ts` — snapshots `baseEngineInput` for a deterministic fixture. Catches any refactor that accidentally changes a default, a derived value, or a memoization dependency in the engine input pipeline.
- `.claude/worktrees/` added to both `.eslintignore` and `.prettierignore` (unblocks repo-wide lint runs when parallel refactor worktrees are active).

**Tests:**

- Two pre-existing failures in `projection-splits.test.tsx` (stale `"Success Rate"` / `"End Balance"` assertions carried over from a v0.5.0 label rename + missing `CoastFireCard` mock) — fixed on both v0.5.1 and v0.5.2 to keep the suite green.

**Navigation comments (not splits):**

- `schema-pg.ts` and `recently-retired.ts` both got section banner comments for navigation but were intentionally NOT split. Splitting `schema-pg.ts` would require rewriting the `gen-sqlite-schema.ts` codegen (mechanical text transform on a single-file input); splitting `recently-retired.ts` fragments what's logically one coherent demo data object.

---

## [0.5.1] - 2026-04-13

### New

- **Coast FIRE age** on the Retirement page and Dashboard — answers "when can I stop contributing and still fund my plan through end of plan?". Binary-searches candidate coast ages via the projection engine and reports the earliest passing age, or flags the plan as already Coast or unreachable. Success criterion: portfolio doesn't deplete AND sustainable withdrawal at retirement covers projected expenses. Displayed in today's dollars
- **Combined baseline + simulated headline on the Coast FIRE card** — shows "Already ✓" only when BOTH the baseline (expected-return) answer and the simulated (1,000 Monte Carlo trials at 90% confidence) answer agree. When baseline says "already" but simulated needs more margin (sequence-of-returns risk), displays the simulated age with a "need age N for 90%" caption. Surfaces the raw simulated success rate at today's age as "Stopping today: X% simulated" so you can see the gap between the two answers
- **Coast FIRE scenario toggle on the projection chart** (labeled "Active Plan / Coast FIRE") — flips the whole chart, hero KPIs, and table to show the Coast FIRE what-if instead of your active plan. Monte Carlo fan bands, deterministic bars, axes, labels, and KPI values all swap atomically. Data is prefetched in the background on page load so the toggle is instant
- **Coast FIRE via contribution profiles** — you can now create a contribution profile with zero contributions and use the existing Overrides panel → Contribution / Salary override to switch to it at a chosen year. Gives you explicit control over when to coast (vs the auto-detected Coast FIRE age) using existing UI. Before this release, the engine silently fell back to a 25% default contribution rate when a switched profile had zero contributions, which defeated the intent
- New **Plan Health tab** on the Retirement page — Plan Health callouts moved into their own tab alongside Projection and Strategy Comparison, instead of being rendered above every other view

### Changed

- **Sidebar: "Historical" moved from Analysis into Net Worth.** The Historical page is a year-end net worth ledger — it belongs next to the Trends summary under Net Worth, not alongside forward-looking tools like Retirement and Contributions. Help content mirrors the new grouping.

### Fixed

- **Monte Carlo assumptions bar: "initial rate" typical-range hint is now strategy-aware.** The sub-label under the withdrawal-rate cell was hardcoded as `3–4%` (the classic fixed-strategy SWR band) even when the active strategy was a dynamic one where sustainable initial rates run higher (~5.0% for Spending Decline, ~5.2–5.6% for Guyton-Klinger per Morningstar 2025). Now shows `4–6%` when the label reads "initial rate" (dynamic strategies) and keeps `3–4%` when the label reads "withdrawal" (fixed). Prevents the misleading implication that a 5% dynamic initial rate is "out of range."

### Engine / internals

- New pure calculator `src/lib/calculators/coast-fire.ts` — additive, calls `calculateProjection()` without modifying the engine
- New tRPC procedures `projection.computeCoastFire` (deterministic, fast) and `projection.computeCoastFireMC` (rate-limited, MC-based binary search with boundary re-probe for non-monotone plans). The MC procedure returns its final-probe `MonteCarloResult` so the chart's fan bands and the hero card's validation read from a single query — no duplicate Monte Carlo runs
- Router-side `buildCoastFireProfileSwitches` helper merges a synthetic zero profile switch with any user-authored profile switches at the coast year. Empty `contributionSpecs`, all-zero employer match, zero base-year contributions/match, contribution rate 0 — lets the engine correctly zero contributions sticky-forward while preserving pre-coast-year user switches
- `projection.computeProjection` and `projection.computeMonteCarloProjection` now accept a `coastFireOverrideAge` input; when set they thread the synthetic profile switch through the engine. Coast FIRE display values deflated to today's dollars at the router boundary (matches the convention used by `retirement-card.tsx`)
- Fixed profile switch fallback at `retirement.ts:860`: when a switched contribution profile has salary but zero contributions, the engine now correctly uses rate 0 (intentional zero) instead of silently falling back to 25%. This unlocks the Coast FIRE via contribution profiles workflow
- Unified terminology across Coast FIRE UI: "baseline" consistently refers to expected-return / point-estimate values, "simulated" refers to Monte Carlo outcomes, "Active Plan" is the scenario toggle name for your configured plan. No more overloaded "baseline" or jargon "deterministic / MC" references in user-facing copy

## [0.5.0] - 2026-04-13

> What changed since v0.4.0. For patch-level detail, see the v0.4.x entries below.

### Upgrading from v0.4.x

Pull the new image and restart — your database auto-upgrades on first boot. An existing v0.4 install is detected automatically, the database is backed up before any change, and the v5 schema migration runs in place with zero manual steps.

**New environment variable required in production:** `ENCRYPTION_KEY`. Generate a 32-byte base64 value (`openssl rand -base64 32`) and set it before restarting — without it the container refuses to start. This protects at-rest encryption of your YNAB / Actual Budget credentials.

### Security

- YNAB and Actual Budget API tokens are now encrypted at rest with AES-256-GCM. Existing installs transparently upgrade on first write — previously your budget API credentials sat in the database as plaintext JSON
- User-supplied Actual Budget server URLs are now validated against private IP ranges; the app refuses to connect to loopback, RFC1918, or link-local addresses unless the host is explicitly allowlisted
- If a sync run fails partway through, the budget API cache is now rolled back atomically instead of being left in a half-updated state — you'll either see the new data or the old data, never a mix
- Production deployments now fail loud at startup if the cron secret is missing, if the dev-mode auth bypass is enabled, or (new this release) if the at-rest encryption key is missing. Previously these were silent defaults
- Login sessions now expire after 4 hours instead of 24
- App container now waits for Postgres to pass its healthcheck before starting, eliminating the startup race where the app crashed trying to connect before the DB was ready
- New encrypted off-site backup script — a one-command `pg_dump` wrapped in AES-256 encryption that you can pipe to S3 / rclone / restic, plus a restore-drill runbook
- Bumped Next.js to 16.2.3 to patch a high-severity Server Components Denial of Service advisory (GHSA-q4gf-8mx6-v5v3)
- Projection page write operations now require the scenario permission instead of accepting any signed-in user

### New

**Retirement projections:**

- **Plan Health card** on the retirement page surfaces up to five findings in context: contribution priority warnings (flags taxable-before-tax-advantaged or HSA behind other tax-advantaged accounts), glide path mismatch (compares your current stock allocation against the "110 − age" rule of thumb), rosy-assumption flags (return > 8%, inflation < 2.5%, salary growth > 4%), a recommended withdrawal strategy with a one-sentence rationale, and a ±25% band around your deterministic nest egg estimate so you can see the uncertainty without switching to the Monte Carlo view
- **Stress test panel** runs your plan through three canonical scenarios — Conservative (bottom-decile 30-year returns, elevated inflation), Baseline (long-run US averages), and Optimistic (top-quartile returns). Shows the nest egg outcome for each side by side with your own plan assumptions
- **Strategy picker** now marks the recommended option with "★ … — Recommended" based on your horizon and whether you have a budget linked
- Monte Carlo confidence bands (50% / 80% / 90%) on Balance, Strategy, and Budget views of the Spending Stability chart
- Three-way chart toggle on the retirement page: Balance, Spending Stability, Deterministic
- "Vs Strategy" and "Vs Budget" spending stability donuts — the first measures against year-1 withdrawal, the second against your stated retirement budget
- Strategy Analyzer: opt-in "Analyze My Strategy" button runs what-if scenarios and shows the top 3 parameter changes that would improve success rate or spending stability
- Strategy Guide flyout on Projection and Strategy Comparison tabs explains each strategy's mechanics, strengths, weaknesses, and expected Stability score

**Paycheck view:**

- Three-mode paycheck view: "Current Salary" (forward planning at today's rate), "Year-End Estimate" (blended annual accounting for mid-year raises), and "Actual YTD" (elapsed periods only)
- Year-End Estimate walks each pay period at its effective salary, correctly handling SS cap transitions and percent-of-salary contribution changes across mid-year raises
- All contribution metrics (IRS utilization bars, funding percentages, savings rates, "% to max" recommendations) now react to the View toggle — previously only summary totals changed

**Performance & trends:**

- **Update Performance form** — batch-edit current-year account flow data (contributions, employer match, distributions, rollovers, fees) from a single form instead of clicking individual cells. Ending balance can pull from the latest portfolio snapshot or be entered manually; gain/loss auto-calculates live
- **Lifetime field cascade** — editing account data on a finalized year now recomputes lifetime totals across every subsequent year automatically
- **Spreadsheet view for Trends page** — dense year-over-year comparison, financial health stats, tax location breakdown, and net worth location. Toggle between card and spreadsheet layouts
- **Projected FI Year** — linear extrapolation of when financial independence will be reached, with prior-year reference when current year shows "Progress Stalled"
- **Retirement parent category rollup rows** show combined retirement account totals alongside per-account-type detail
- **Year-over-year comparison** with Projected / Actual YTD toggle — contributions are prorated for meaningful comparisons, gains/losses shown as-is
- **Cost basis tracking** per account on the Performance page Brokerage tab, with computed unrealized gain column
- **Chart X-axis toggle** — switch between Year and Age on the Net Worth Over Time and Journey to Abundance charts

**Per-person retirement engine:**

- Each spouse can now retire at a different age; the still-working spouse continues contributing while the retired spouse stops
- Per-person Social Security with individual claiming ages and per-person breakdown in tooltips
- Per-person RMDs computed from each spouse's birth year and individual Traditional account balances, following SECURE 2.0 rules
- Per-person IRMAA — Medicare surcharge correctly applies to each spouse independently when both are 65+

**Brokerage & contributions:**

- Brokerage page redesigned: single-page layout with collapsed goals and a "Planned Events" replacing the separate Transactions tab
- Today's $ / Future $ toggle with inflation-adjusted view
- Per-account "After retirement" setting — stop contributions, continue until last person retires, or continue indefinitely
- Per-account contribution scaling (with salary or fixed) to prevent fixed-dollar contributions from dropping during staggered retirement
- Portfolio snapshot import automatically pulls YNAB balances for linked tracking accounts

**Overrides:**

- Wizard-style "Add Override" flow — pick year, pick what to change, fill 1-3 fields — replaces three dense forms
- Database persistence — withdrawal rate, routing mode, account caps, Roth conversion targets, and lump sums survive page refresh
- Lump sums target specific accounts and appear in the retirement projection table with In/Out column, contribution columns, and balance tooltips

**Sync (YNAB / Actual Budget):**

- **Drift detection** — after every sync, the app compares the cached account list against what came back fresh and flags broken mappings (accounts deleted upstream), renamed accounts, and new remote accounts so you can fix them in the UI instead of losing sync coverage silently
- **Deterministic idempotency keys** on transaction creation — if a sync is interrupted and retried, the upstream API deduplicates the request automatically instead of creating a duplicate transaction
- **Automatic retry with exponential backoff** on rate-limit / server / network errors (1s → 2s → 4s, capped at 30s), honoring `Retry-After` headers on 429. Authentication errors surface immediately without retry
- **Resync button** on every snapshot row in the Portfolio history table — re-pushes that snapshot to YNAB by removing its previous tagged adjustments and posting fresh ones
- Snapshot-to-YNAB adjustments now carry a traceable memo tag and contributor account names so each YNAB entry points back to the originating Ledgr snapshot
- New portfolio snapshots post one summed adjustment per YNAB tracking-account group instead of a separate transaction per mapping
- YNAB account linking for Retirement Brokerage accounts; linked accounts use YNAB as the balance source of truth

**Accessibility:**

- Users with "reduce motion" preference now get a reduced-animation experience automatically
- Screen readers no longer announce decorative icons as path data — every inline icon in the app is now correctly marked as decorative or labeled
- Sidebar collapsibles announce their expanded/collapsed state to assistive tech
- Amber badges and callouts bumped to darker shades to meet WCAG 4.5:1 contrast on near-white backgrounds
- Data tables now emit proper column-header semantics and the projection table carries a screen-reader caption describing the grid

**Undo & feedback:**

- Deleting a planned savings event now shows a 5-second undo toast — click Undo to restore it instead of having to re-create from scratch
- Form save errors now categorize by type (auth, permission, rate limit, validation, server, network) and show appropriate recovery UI (relogin prompt, cooldown window, retry button) instead of a generic "something went wrong"
- Form edits now update optimistically — the UI reflects your change immediately and rolls back if the save fails

### Improved

- Retirement page now defaults to the Monte Carlo view (the Deterministic / MC toggle was removed — MC overlays on top of deterministic with no unique deterministic-only content)
- All user-facing jargon renamed: "Det" → "Baseline", "MC Bands" → "Confidence Band", percentile notation → confidence percentages, "MC median" → "Sim. median"
- Retirement, portfolio, and networth pages load faster on first paint — the most expensive data query starts on the server before the client mounts
- All chart components are now lazy-loaded, dropping roughly 250KB off the initial download for pages that don't show charts
- Dashboard cards no longer re-render unnecessarily when a single card's query invalidates
- Spending stability chart shows a dollar Y-axis alongside the percentage axis, with withdrawal and plan amounts in tooltips
- Strategy dropdowns now update instantly via optimistic cache updates instead of waiting 7-30s for a full projection recompute
- Health stats on the Trends page show trajectory context when the current year is selected ("was X at year-end YYYY")
- Wealth Score, AAW Score, and FI Progress now computed once in a shared helper — no more inconsistencies across the dashboard, contributions, and savings rate pages
- Wealth Score changed to net worth / lifetime earnings (a clearer savings efficiency percentage)
- AAW Score uses the Money Guy formula with average household age and Combined AGI
- Savings rates use total compensation (including bonus) as the denominator everywhere, instead of mixing salary and total-comp across pages
- Home value cost basis now correctly computed from cumulative improvement items instead of a broken per-year DB column
- Restructured retirement page: spending strategy, budget, and withdrawal rate grouped in a "Decumulation Plan" section; Withdrawal Routing in a compact collapsed view with a sunken expanded panel
- Budget and withdrawal-rate controls visually dim when the selected strategy doesn't use them
- Fixed 148 instances of missing spacing between variables and text across the app
- Softer, theme-aware card borders in both light and dark mode
- Upgraded to Next.js 16 with Turbopack for faster development builds
- "Recently Retired" demo profile with a realistic account mix (401k, 403b, IRA, Roth, brokerage)

### Fixed

**Retirement engine:**

- Post-retirement brokerage contributions no longer inflate retirement projection balances — brokerage-category post-retirement contributions are modeled on the brokerage page only, restoring correct Monte Carlo success rates
- Vanguard, Constant Percentage, Endowment, and RMD strategies now correctly skip post-retirement inflation (dimmed UI settings no longer silently affect projections)
- RMD pre-RMD fallback spending now grows with CPI to maintain purchasing power during the 10-18 year gap before RMD age
- Spending Decline now produces a true real decline instead of a steeper nominal decline that over-cut by the full inflation rate
- Guyton-Klinger guardrail parameters now pair correctly (Upper Guardrail with Increase %, Lower Guardrail with Decrease %)
- Monte Carlo stochastic inflation now affects post-retirement expense growth (previously only pre-retirement inflation was randomized, leaving decumulation expenses fixed across all trials)
- Strategy comparison now uses your saved Monte Carlo inflation overrides instead of the hardcoded 2.5% default

**Contributions & paycheck:**

- Contribution blended estimates no longer double-count when multiple contribution accounts share a single performance account
- Year-End Estimate accounts for stale performance data by filling only the exact missing payroll periods at the current projected rate
- Monthly and annual contributions are no longer flagged stale when biweekly paydays pass
- Over-limit "Over" badge no longer triggers from sub-cent rounding noise
- "Over by" amount for HSA and other match-counts-toward-limit accounts now uses total contribution instead of just employee contribution
- Portfolio employer match (ESPP discount) in YTD view is correctly attributed to portfolio totals instead of retirement match

**Data integrity:**

- Internal data invariants tightened: missing or orphan rows now surface as clear errors instead of silently substituting "Unknown" or zero — bad data is caught early instead of producing wrong-but-quiet numbers downstream
- Historical net-worth records backfilled with correct portfolio tax-location breakdowns

**Budget & expenses:**

- Expense page no longer counts YNAB savings allocations and reimbursements as spending — only outflows are included in actual amounts
- Credit card payment transfers no longer appear as spending
- Year-over-year comparison no longer shows $0 for the prior year

**Other:**

- Corrected 5 incorrect 2025 IRS contribution limits that were using 2026 values
- First-year pro-rating now excludes the current month after mid-month
- Mortgage current-balance detection no longer reads system time mid-request
- Fixed Docker build failure on Node.js 25

### Under the hood

- All v0.4.x migrations squashed into a single clean v5 baseline — new installs get two migration files instead of dozens
- Pre-upgrade auto-backup handles v0.1.x, v0.2.x, v0.3.x, and v0.4.x databases
- Financial decimal columns widened so no legitimate balance can overflow
- Added two missing foreign-key indexes flagged by the audit
- Finalized annual performance rows are now marked immutable — the only way to modify their lifetime totals is through the proper cascade helper, preventing stale or inconsistent numbers
- 2,977 automated tests (up from ~2,300 in v0.3.0) covering financial calculations, budget API integrations, database compatibility, accessibility regressions, and backup round-trips
- Automated tax parameter staleness check in CI that fails the build if we're beyond the current tax year without a deliberate override
- Three new end-to-end user journeys (auth, scenario edit, sync integration) and a component-level test of the login form contract
- In-app glossary page for finance jargon, with definitions sourced from a single config
- One-command dev quickstart script (`setup-dev.sh`) that installs, configures env, runs migrations, and seeds a fresh dev database

### Known deferred

- Insurance gap analysis cards (life / disability / umbrella / beneficiary tracking) — planned but needs its own design pass
- Expanded test fixture profiles ($250k single earner, gig worker, HENRY) — tracked for a follow-up release

---

# v0.4

## [0.4.21] - 2026-04-12

### Added

- IRS limit utilization bars, funding percentages, savings rates, and "% to max" recommendations now react to the View toggle (Current Salary / Year-End Estimate / Actual YTD) — previously only summary dollar totals changed
- Contribution dollar amounts shown per account type now reflect the active view: Year-End Estimate shows salary-timeline-weighted totals accounting for mid-year raises, Actual YTD shows real performance data

### Fixed

- Contribution blended estimates no longer double-count when multiple contribution accounts share a single performance account — year-to-date actuals are split proportionally by expected contribution
- Employer match is now correctly subtracted out of stored performance totals so employee-only year-to-date amounts aren't inflated by the match
- Year-End Estimate accounts for stale performance data by filling only the exact missing payroll periods at the current projected rate, rather than replacing or ignoring the actuals
- Monthly and annual contributions (IRA, etc.) are no longer flagged as stale when biweekly paydays pass — stale-gap fill only applies to payroll-cadence contributions
- Contribution cadence (monthly vs biweekly vs annual) is now used for the blended remaining-fraction calculation, so monthly IRA contributions don't show false shortfalls against biweekly period counts
- Over-limit "Over" badge and red bar no longer trigger from sub-cent rounding noise
- "Over by" amount for HSA and other match-counts-toward-limit accounts now correctly uses total contribution (employee + match), not just employee contribution
- Portfolio employer match (ESPP discount) in year-to-date view is now correctly attributed to portfolio totals instead of being lumped into retirement match
- Mortgage current-balance detection no longer drifts when requests span a day boundary
- Savings rate card group breakdown (retirement vs taxable) now uses view-aware totals instead of projected-only rates

### Security

- Projection page write operations now require the scenario permission instead of accepting any signed-in user

### Changed

- Blended savings rate uses salary-timeline-weighted total compensation as the denominator, correctly reflecting mid-year salary changes

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

- Financial amount fields on performance edits now reject invalid values (non-numeric strings) at the form boundary
- Account type fields validated against the config enum everywhere — previously some edit paths accepted arbitrary strings
- Projection overrides now accept the brokerage permission instead of incorrectly requiring admin
- Demo mode blocks the data import/export API routes (previously these bypassed the demo guard)
- Performance tabs and the finalize modal now share a single category display order

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

- All wealth metrics (Wealth Score, AAW Score, FI Progress) now share a single computation path — no more inconsistencies between the dashboard, contributions page, and Trends page
- Wealth Score changed to net worth / lifetime earnings (a clearer savings-efficiency percentage)
- AAW Score uses the Money Guy formula with average household age and Combined AGI
- Market value / cost basis toggle now affects every metric consistently: year-over-year table, health stats, net worth location, pie charts, and Journey to Abundance benchmarks
- Salary averaging toggle now propagates to Journey to Abundance benchmark lines
- Tax location data now snapshots at year-end finalization instead of being re-derived from config
- Home value cost basis correctly computed from cumulative improvement items instead of a broken per-year column
- Current-year gross income includes bonus for wealth-metric denominators
- FI Progress on the dashboard now includes cash (consistent with the Trends page)
- Zebra striping on all spreadsheet tables for readability

### Fixed

- FI Progress calculation was excluding cash
- Tax location breakdown was mixing two key-casing styles and producing duplicate rows
- Wealth score labels are now consistent across the dashboard metrics row and Financial Checkup card

### Changed

- Net worth calculator produces dual market/cost-basis scores for wealth and AAW metrics
- AAW thresholds updated: PAW >= 2.0, AAW >= 1.0 (previously baked in a 2× factor)
- Net worth records now carry a point-in-time tax location breakdown captured at year-end finalization

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

- Both stability columns (strategy + budget) shown in the strategy comparison table
- Budget stability metric added to the Monte Carlo engine — compares withdrawals against your retirement budget (inflation-adjusted) instead of year-1 withdrawal

---

## [0.4.10] - 2026-04-01

### Improved

- Today's $ / Future $ toggle on the Strategy Comparison tab, shared with the Projection tab — toggling one updates both
- Strategy guide content moved into the withdrawal strategy config so every strategy's help text is maintained in one place
- Removed the dead Compact/Expanded table toggle (All Years toggle already provides this)
- Decumulation settings layout further compacted with a 2-column strategy parameter grid

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
- Restored projection scope badges on the retirement page section headers showing which settings affect Deterministic, MC Simple, and MC Advanced modes (lost in an earlier refactor)

---

## [0.4.3] - 2026-03-31

### Fixed

- Expense page was counting YNAB savings allocations and reimbursements (positive activity) as spending — only outflows (negative activity) are now included in actual amounts

---

## [0.4.2] - 2026-03-31

### Fixed

- Post-retirement contributions for Portfolio-category accounts now appear in the brokerage page Year-by-Year table — values are shown in the brokerage view without inflating retirement engine balances

---

## [0.4.1] - 2026-03-30

### Fixed

- Portfolio-category (brokerage) contributions no longer inflate retirement projection balances — post-retirement brokerage contributions are modeled on the brokerage page only, restoring correct Monte Carlo success rates

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
- Post-retirement brokerage contributions now grow with the limit growth rate (inflation) instead of staying flat
- Budget linking badge now resolves correctly — previously never matched because it compared display labels instead of raw category keys
- YNAB linking badge now resolves correctly for accounts that don't yet have a performance-account link
- Contribution account linking dropdown no longer hides budget items that are already linked to API categories
- Planned Events tooltip no longer incorrectly references IRS contribution limits (brokerage has none)

---

## [0.3.27] - 2026-03-30

### Added

- Brokerage accounts can now be linked to YNAB tracking accounts — linked accounts use YNAB as the balance source of truth
- New "Account Linking" section on the brokerage page with link/unlink controls and YNAB badges
- Portfolio snapshot import automatically pulls YNAB balances for linked accounts before pushing

### Improved

- Consolidated the brokerage page from 3 tabs to 2: removed "Transactions" tab, renamed "Lump Sum Events" to "Planned Events"
- Planned Events now use the same engine-integrated lump sum system as the retirement page instead of a separate goal-linked transaction system

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
- Backup files exported from one version now round-trip back through import without data loss, including across schema upgrades

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

- Fixed Docker build failure on Node.js 25

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

- 2,300+ automated tests covering financial calculators, server logic, and backup round-trips
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
