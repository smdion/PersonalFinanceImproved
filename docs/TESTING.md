# Test Suite

Run all tests:

```bash
pnpm test            # single run (vitest)
pnpm run test:watch  # watch mode
pnpm test:coverage   # with coverage report
pnpm test:e2e        # E2E tests (Playwright, requires running server)
```

Framework: [Vitest](https://vitest.dev/) with globals enabled. E2E: [Playwright](https://playwright.dev/).

---

## Overview

| Suite             | Files | Tests | Purpose                                                                                 |
| ----------------- | ----- | ----- | --------------------------------------------------------------------------------------- |
| **Calculators**   | 18    | ~550  | Unit tests for every calculator module + logic gaps + spending strategies               |
| **Benchmarks**    | 11    | ~88   | Validates engine against published research and institutional data                      |
| **Config**        | 4     | ~131  | Account types, IRS limits, RMD tables, tax parameter freshness                          |
| **Edge Cases**    | 1     | ~40   | Boundary and extreme inputs across all calculators                                      |
| **Invariants**    | 1     | 29    | Property-based testing with fast-check (580+ generated inputs)                          |
| **Snapshots**     | 3     | 71    | Byte-identical output after refactoring                                                 |
| **Components**    | 13    | ~144  | UI component behavior + dashboard + error boundary + sidebar                            |
| **Accessibility** | 1     | 11    | axe-core ARIA/a11y checks on UI components                                              |
| **Integration**   | 1     | ~40   | Zod schema validation for tRPC inputs and JSONB columns                                 |
| **Routers**       | 39    | ~1246 | tRPC router integration tests (all routers + auth enforcement)                          |
| **Helpers**       | 10    | ~193  | Server helper unit tests (budget, contribution, salary, snapshot, transforms, settings) |
| **E2E**           | 9     | 35    | Playwright smoke tests (health, navigation, page flows)                                 |

Total: **<!-- AUTO-GEN:totalTests -->2326<!-- /AUTO-GEN --> tests** across **<!-- AUTO-GEN:vitestFiles -->118<!-- /AUTO-GEN --> vitest files** + **35 Playwright E2E tests** (<!-- AUTO-GEN:e2eFiles -->9<!-- /AUTO-GEN --> files).

### Coverage

Coverage is scoped to `src/lib/calculators/**` and `src/server/**` (excluding type definitions, auth infra, barrel re-exports, and runtime-only modules). Thresholds configured in `vitest.config.ts`:

| Metric     | Threshold |
| ---------- | --------- |
| Statements | 85%       |
| Branches   | 70%       |
| Functions  | 80%       |
| Lines      | 85%       |

Run `pnpm test:coverage` to generate an HTML report in `coverage/`.

---

## Calculator Tests

`tests/calculators/`

### budget.test.ts — 7 tests

Tests the budget calculator: category grouping, essential vs discretionary splitting, multi-column selection.

- Calculates monthly totals across Standard / Tight / Emergency columns
- Splits items into essential (housing, utilities, insurance) vs discretionary (dining, entertainment)
- Groups items by category with correct subtotals
- Handles empty budget gracefully

### contribution.test.ts — 9 tests

Tests contribution calculations for retirement accounts including employer match.

- Per-person annual contributions (Person A, Person B) with employer match
- Percentage-of-salary breakdowns per account
- Group rates (retirement vs portfolio)
- Household totals validated against Budget Overview.xlsx (within +/-$50)
- ESPP 15% discount modeled as employer match

### efund.test.ts — 9 tests

Tests emergency fund calculator: coverage months, target progress, self-loan adjustments.

- Months of coverage = balance / essential expenses
- Target amount = target months x essential expenses
- Self-loan tracking with "with-repay" adjusted balance
- Progress capped at 100%
- Edge: zero expenses returns null months

### engine-invariants.test.ts — 29 invariants x 20 runs

**Property-based testing** with [fast-check](https://github.com/dubzzz/fast-check). Generates random valid inputs and asserts invariants that must hold for ANY input:

- Balance conservation (start = end + withdrawals - contributions)
- Age sequencing (no gaps or reversals)
- Contribution limits never exceeded
- Tax calculations non-negative
- Salary/expense monotonicity (grow with inflation)
- Glide path within bounds at every year
- Traditional/Roth splits valid (sum to 100%)
- Phase transitions (accumulation -> decumulation, never reversed)

### engine-snapshot.test.ts — 62 fixtures

**Snapshot tests** ensuring engine output is byte-identical after refactoring. Covers:

- Single-person and multi-person households
- Early retirement (age 35->55) and traditional (65)
- Conservative (3.25% SWR) through aggressive strategies
- Salary caps, overrides, growth rates
- Multiple return rates (4%, 7%, 10%)
- Roth conversions and tax strategies
- Brokerage goals and planned transactions

Uses `roundDeep()` to eliminate floating-point noise before snapshot comparison.

### math.test.ts — 6 tests

Utility math functions: `safeDivide` (zero-denominator safety), `roundToCents`, `sumBy`.

### monte-carlo-integration.test.ts — 4 fixtures

Integration tests for the Monte Carlo simulation pipeline (engine -> `calculateMonteCarlo`).

- 2 asset classes with simple glide path (50 trials)
- Stochastic inflation risk
- Conservative allocation (heavy bonds)
- Near-retirement scenario (age 60->65->90)

### mortgage.test.ts — 10 tests

Full amortization, extra payments, refinancing, and what-if scenarios.

- 30yr fixed at 6.5% — validates month-by-month interest/principal split
- Extra payments reduce total interest and accelerate payoff
- What-if comparison across payment amounts
- Refinance chains preserving original loan history

### net-worth.test.ts — 7 tests

Net worth calculation including wealth score and FI progress.

- Net worth (market value vs cost basis)
- Wealth score using Millionaire Next Door formula
- FI progress = portfolio / FI target
- Age 40+ denominator adjustment
- Edge: zero income, zero expenses, zero withdrawal rate

### paycheck.test.ts — 15 tests

Paycheck modeling: gross pay, federal withholding, FICA, deductions, bonus.

- Gross = salary / 26 periods
- Federal withholding using IRS W-4 2(c) checkbox brackets
- FICA Social Security with wage base cap ($176,100)
- FICA Medicare base + additional surtax (> $200k)
- Pre-tax vs post-tax deduction separation
- Bonus estimates with supplemental rate
- Year schedule modeling SS wage base exhaustion

### savings.test.ts — 9 tests

Savings goals allocation and progress tracking.

- Overall progress = total saved / total targets
- Monthly allocation per goal
- Months to target (remaining / allocation, ceiling)
- Allocation percentages sum to 100%
- Excludes inactive goals
- Progress capped at 100%

### tax.test.ts — 13 tests

Tax bracket math, FICA, effective rates — validated against IRS 2025/2026 published tables.

- Federal bracket walk (multi-bracket calculation)
- Standard deduction ($30k MFJ)
- Marginal rate identification
- SS wage base cap and Medicare surtax
- W-4 2(c) checkbox override
- Zero income edge case

### brokerage-goals-integration.test.ts — 5 fixtures

Integration tests: engine output -> `calculateBrokerageGoals`.

- Multiple goals at different target years
- Overflow handling (contributions exceeding capacity)
- Brokerage ramp (increasing contributions over time)
- Category filtering
- Planned transactions layered on projections

### logic-gaps.test.ts — 27 tests

Cross-calculator consistency and edge cases not covered by individual calculator suites.

- FICA base distinction: `ficaExempt=false` deductions don't reduce FICA base
- Cross-calculator coherence: paycheck + budget + contributions together
- Bonus month placement and schedule integration
- Tax MFJ Additional Medicare: $250k liability vs $200k withholding threshold
- Paycheck SS wage base cap transition mid-year
- Mortgage refinance chain interest attribution
- Net worth age-40 wealth formula transition
- Budget multi-column emergency vs standard comparison

### spending-strategies.test.ts — 24 tests

Unit tests for all spending strategy engine modules in isolation.

- Guyton-Klinger guardrails (ceiling/floor triggers, spending adjustments)
- Vanguard Dynamic (ceiling/floor bands, smoothing)
- Constant Percentage (fixed % of portfolio balance)
- Endowment (blended inflation-adjusted + percentage)
- Spending Decline (age-based reduction)
- Forgo Inflation (skip inflation adjustments)
- RMD Spending (RMD as spending floor)
- Strategy dispatcher (selects correct strategy by name, falls back to baseline)

### savings-capacity.test.ts

Tests savings capacity calculations: after-expense surplus, allocation ratios.

### relocation.test.ts

Tests relocation calculator: state tax comparisons, cost-of-living adjustments.

---

## Benchmark Tests

`tests/benchmarks/`

These tests validate the retirement engine against published academic research and institutional data. They use wider tolerances (+/-8pp success rate, +/-15% balances) to account for differences between log-normal simulation and historical backtesting.

### accumulation-sanity.test.ts — 9 tests

Validates deterministic engine against hand-calculable formulas.

- Rule of 72 / compound growth ($100k @ 7% for 10yr ~ $196.7k)
- Salary growth over 30 years
- Expense inflation tracking
- Simple depletion at 0% return
- Accumulation with contributions (future value of annuity)

### asset-assumptions.test.ts — 14 tests

Documents return/volatility assumptions against institutional published data.

- Asset class returns vs Vanguard VCMM, Morningstar, Ibbotson ranges
- Volatility within published bounds
- Correlation matrix is positive semi-definite (Cholesky succeeds)
- Equity-equity correlation positive (~0.75), equity-bond negative (~-0.10)
- Deterministic return schedule monotonically declining

### cfiresim-comparison.test.ts — 4 tests

Validates Monte Carlo output against [cFIREsim](https://www.cfiresim.com/) historical backtesting.

- 4% SWR, 75/25, 30yr -> ~95-96% success (matches cFIREsim)
- 3.25% SWR, 75/25, 40yr -> ~96-98% success
- SWR sweep curve (3%-6%) comparison
- Uses Ibbotson asset classes for comparability (5,000-10,000 trials)

### complexity-cost.test.ts — 1 test (4 layers)

Isolates success rate impact of each complexity layer:

1. Pure retirement, single brokerage, 0% tax
2. \+ realistic tax rates (22% traditional, 15% brokerage)
3. \+ multi-account split (traditional/Roth/HSA/brokerage)
4. Full lifecycle (accumulation + decumulation)

### diagnose.test.ts — 1 test (7 configs)

Compares glide path configurations and their impact on success rates:

- cFIREsim-equivalent (Ibbotson + 75/25 flat)
- Vanguard TDF (25% equity floor)
- FIRE-adjusted (40% equity floor)
- FIRE-aggressive (50% equity floor)
- Flat 60/40 vs flat 75/25

### glide-path.test.ts — 10 tests

Validates FIRE-adjusted glide path structural properties.

- Equity allocation at key ages (25, 35, 45, 55, 65, 75, 85)
- Allocations sum to 100% at every age
- Equity monotonically decreases, bonds+TIPS monotonically increase
- No negative allocations
- Smooth interpolation (no jumps > 5pp between adjacent ages)

### monte-carlo-properties.test.ts — 10 tests

Validates Monte Carlo statistical distribution properties.

- Log-normal right skew (mean > median)
- Percentile ordering (p5 < p10 < ... < p95) at every year
- Spread factor p90/p10 ratio (3-10x)
- Seed reproducibility (same seed -> identical results)
- Trial count convergence (1000 vs 5000 < 3pp difference)

### real-scenario.test.ts — 1 test

Full lifecycle comparison: accumulation+decumulation vs retirement-only.

- Full: age 37->55->95, $731k start, $86k/yr contributions
- Retirement-only: age 55->95, $2.77M start, $90k expenses
- Reports success rates, median/P10 end balances, portfolio distribution

### tax-accuracy.test.ts — 11 tests

Validates tax calculations against IRS 2025/2026 published tables (Rev. Proc. 2024-40).

- Standard deduction, bracket walk, effective rates
- SS wage base cap ($176,100) and Medicare surtax
- Income-level sweep validating effective rate ranges

### trinity-study.test.ts — 8 tests

Validates against the [Trinity Study](https://en.wikipedia.org/wiki/Trinity_study) (Cooley et al. 1998).

- 4% SWR, 50/50, 30yr -> 90-100% success (Trinity ~95%)
- 3% SWR -> ~100%, 6% SWR -> 55-85%
- cFIREsim cross-reference (75/25, 30yr -> 93-100%)
- Time horizon sensitivity (20yr vs 30yr vs 40yr)

### withdrawal-sensitivity.test.ts — 2 suites

Documents success rate response curves.

- SWR sweep (3%-6% in 0.5% steps): monotonically decreasing success
- Time horizon sweep (20yr-40yr): monotonically decreasing success
- Validates: 3% SWR > 97%, 4% SWR > 85%, 6% SWR < 90%

---

## Config Tests

`tests/config/`

### account-type-config.test.ts — 30+ tests

Validates account type configuration completeness and helper function correctness.

- Config has exactly 5 categories (401k, 403b, hsa, ira, brokerage)
- Every entry has all 23 required properties
- Helper functions: `getAllCategories`, `getEngineCategories`, `categoriesWithTaxPreference`, `getRothFraction`, `getEffectiveLimit`, `isOverflowTarget`, `getLimitGroup`
- Balance accessor strategies (roth_traditional, single_bucket, basis_tracking)
- Column key round-trips
- Default withdrawal splits sum to ~1.0

### irs-contribution-limits.test.ts — 5 tests

Validates contribution limits match IRS-published values.

- 2025 and 2026 limits for 401k, IRA, HSA, catch-up, SS wage base
- Sources cited (IRS Notices, Revenue Procedures)
- Acts as a canary — update when IRS publishes new year limits

### rmd-tables.test.ts — 8 tests

Validates RMD table data and SECURE 2.0 start age logic.

- `getRmdStartAge()`: birth year 1950→72, 1951-1959→73, 1960+→75
- Boundary year transitions (1950/1951, 1959/1960)
- `getRmdFactor()`: correct divisors at ages 72-120
- Uniform Lifetime Table values match IRS Publication 590-B

### tax-freshness.test.ts — 58 tests

Automated tax parameter expiration system. Validates every tax parameter in the codebase against a freshness registry.

- Current year or newer → passes
- 1 year stale → passes with warning
- 2+ years stale → **FAILS** (forces update)
- Covers: LTCG brackets, NIIT thresholds, IRMAA brackets, ACA/FPL tables, SS taxation thresholds, standard deductions, contribution limits, tax brackets
- Links to TAX-PARAMETER-RUNBOOK.md for update procedures

---

## Edge Case Tests

`tests/edge-cases/`

### edge-cases.test.ts — 40+ tests

Boundary and extreme inputs across all calculators. Organized by module:

| Calculator       | Scenarios                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Paycheck**     | Zero salary, very high salary (above SS cap), different pay periods, YTD past SS base, bonus edge cases, deductions exceeding gross |
| **Tax**          | Zero income, below standard deduction, single earner, very high income, pre-tax deductions exceeding gross                          |
| **Budget**       | No items, all-zero amounts, out-of-range column, all essential / all discretionary                                                  |
| **Contribution** | No accounts, zero salary with contributions                                                                                         |
| **Mortgage**     | No loans, already paid off, zero interest rate, all inactive                                                                        |
| **Net Worth**    | Zero everything, negative net worth, very young age, empty portfolio                                                                |
| **Savings**      | No goals, zero pool, zero expenses, goal exceeded target, all inactive                                                              |

---

## Shared Test Utilities

### fixtures.ts

Test data derived from Budget Overview.xlsx, anchored to March 7, 2025:

- `MFJ_2C_BRACKETS` / `MFJ_NO_CHECKBOX_BRACKETS`: 2025 tax brackets
- `PERSON_A_CONTRIBUTIONS` / `PERSON_B_CONTRIBUTIONS`: Account contribution specs
- `PERSON_A_PAYCHECK_INPUT` / `PERSON_B_PAYCHECK_INPUT`: Biweekly paycheck data
- Values use synthetic round-number salaries: Person A $120,000, Person B $110,000

### benchmark-helpers.ts

Factory functions for benchmark test inputs:

- `makePureGrowthInput()`: Lump-sum growth (zero contributions/taxes/SS)
- `makeTrinityInput()`: Trinity Study scenario (4% SWR, retirement-only)
- `makeStandardInput()`: Standard fixture (age 35->65->90, $150k salary)
- `makeMCInput()`: Builds MonteCarloInput from engine input + options
- `TOLERANCES`: +/-8pp success rate, +/-15% balances, +/-2pp rates
- `CURRENT_GLIDE_PATH`: Vanguard TDF + FIRE equity floors

---

## Component Tests

`tests/components/`

### card.test.tsx — 22 tests

Tests Card, Metric, and ProgressBar UI components.

- Card variants: plain, linked, collapsible with `aria-expanded` toggling
- Keyboard navigation (Enter and Space keys)
- `headerRight` rendering and click isolation from toggle
- ProgressBar: zero/negative clamping, boundary values, bar width, custom colors, tooltips
- Metric: label display, custom className application

### toast.test.tsx — 10 tests

Tests toast notification system.

- Renders nothing with empty toasts array
- Single/multiple toast messages with `role="alert"`
- Dismiss callback fires with correct toast ID
- `aria-live="polite"` container attribute
- Variant-specific CSS classes (success/error/info)

### add-item-form.test.tsx — 13 tests

Tests budget item creation form.

- Empty name validation and whitespace rejection
- Correct callback arguments (category, trimmed name, isEssential)
- Enter/Escape key handling, Cancel button
- Disabled state and "Adding..." text during `isPending`
- Parent mutation error display

### add-category-form.test.tsx — 10 tests

Tests budget category creation form.

- Initial collapsed state, form reveal on click
- Empty name and whitespace validation
- Form auto-hide after submit, Escape/Cancel reset

### budget-mode-manager.test.tsx

Tests budget mode selection and persistence.

### contribution-accounts-card.test.tsx

Tests contribution accounts card rendering and interaction.

### fund-card.test.tsx

Tests savings fund card display and progress tracking.

### integrations.test.tsx

Tests integration/sync UI components.

### person-paycheck.test.tsx

Tests per-person paycheck breakdown component.

### refinance-calculator.test.tsx

Tests refinance calculator UI component.

### dashboard.test.tsx — 3 tests

Tests dashboard page rendering with mocked card components.

- Renders without crashing
- All dashboard cards present (net-worth, income, checkup, savings, retirement, contributions, mortgage, savings-rate, budget, taxes)
- Onboarding wizard hidden when complete

### error-boundary.test.tsx — 4 tests

Tests React error boundary component.

- Renders children when no error
- Shows fallback when child throws
- Error boundary catches and displays error message
- Suppresses React error boundary console noise in tests

### sidebar.test.tsx — 8 tests

Tests sidebar navigation component.

- Renders navigation links for all dashboard pages
- Active page highlighted
- Compact mode rendering
- DataFreshness and ThemeToggle integration
- User name and role display

---

## Accessibility Tests

`tests/accessibility/`

### axe.test.tsx — 11 tests

Renders key UI components and runs axe-core checks for ARIA violations.

- Card (plain, linked, collapsible), Metric, ProgressBar
- EmptyState, FormError, FormErrorBlock, PageHeader
- Toggle (with and without label)
- Color-contrast checks disabled (jsdom limitation)

---

## Integration Tests

`tests/integration/`

### zod-schemas.test.ts — 40+ tests

Validates Zod schemas from `src/lib/db/json-schemas.ts` used by tRPC routers.

- Budget: `createItem` input, `columnLabelsSchema`, `columnMonthsSchema`, `budgetAmountsSchema`
- Settings: `settingValueSchema` (all union variants)
- Contributions: `salaryOverridesSchema`, `contribAccountOverrideSchema`, `jobOverrideSchema`, `contributionOverridesSchema`
- Tax: `taxBracketsSchema`
- Sync: `accountMappingSchema`
- Scenarios: `relocationScenarioParamsSchema`
- Tests both valid input acceptance and invalid input rejection

---

## Router Integration Tests

`tests/routers/` — tRPC router integration tests using direct procedure calling (no HTTP layer).

**Test harness:** `setup-mocks.ts` mocks Next.js server modules (next/headers, next/server, next-auth, @/lib/db, @/lib/db/schema, @/lib/db/dialect, @/lib/rate-limit). `setup.ts` provides `createTestCaller()` which creates an isolated SQLite database per test suite with migrations applied, returning a typed tRPC caller.

**Session factories:** `adminSession` (full access), `viewerSession` (read-only), `createViewerSessionWithPermissions([...])` (viewer + specific mutation grants).

**39 test files** covering all routers:

| Router           | Test files                                                                                                                                                                  | Coverage                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Budget**       | budget.test.ts, budget-coverage.test.ts                                                                                                                                     | Profile CRUD, auth, column operations       |
| **Contribution** | contribution.test.ts, contribution-profiles.test.ts, contribution-profiles-coverage.test.ts                                                                                 | Computation pipeline, profile management    |
| **Mortgage**     | mortgage.test.ts                                                                                                                                                            | Active summary, what-if scenarios           |
| **Version**      | version.test.ts, version-extended.test.ts                                                                                                                                   | List/query, changelog                       |
| **Auth**         | auth-enforcement.test.ts                                                                                                                                                    | Cross-router permission validation          |
| **Assets**       | assets.test.ts                                                                                                                                                              | Asset CRUD, categories                      |
| **Brokerage**    | brokerage.test.ts                                                                                                                                                           | Brokerage account management                |
| **Historical**   | historical.test.ts                                                                                                                                                          | Historical data queries                     |
| **Net Worth**    | networth.test.ts                                                                                                                                                            | Net worth aggregation                       |
| **Paycheck**     | paycheck.test.ts, paycheck-coverage.test.ts                                                                                                                                 | Paycheck simulation                         |
| **Performance**  | performance.test.ts, performance-coverage.test.ts                                                                                                                           | Portfolio performance metrics               |
| **Projection**   | projection.test.ts, projection-coverage.test.ts                                                                                                                             | Monte Carlo projections                     |
| **Retirement**   | retirement.test.ts                                                                                                                                                          | Readiness analysis                          |
| **Savings**      | savings.test.ts, savings-router-coverage.test.ts                                                                                                                            | Savings goals                               |
| **Settings**     | settings-admin.test.ts, settings-admin-coverage.test.ts, settings-coverage.test.ts, settings-mortgage.test.ts, settings-retirement.test.ts                                  | Admin settings, mortgage, retirement config |
| **Onboarding**   | onboarding.test.ts, onboarding-coverage.test.ts                                                                                                                             | Onboarding wizard                           |
| **Shared**       | shared-coverage.test.ts, shared-rollups.test.ts                                                                                                                             | Shared procedures, rollup queries           |
| **Sync**         | sync-config.test.ts, sync-connections.test.ts, sync-connections-coverage.test.ts, sync-core.test.ts, sync-mappings.test.ts, sync-names.test.ts, sync-names-coverage.test.ts | Full sync pipeline                          |
| **Tax Limits**   | tax-limits.test.ts                                                                                                                                                          | IRS limit CRUD                              |

---

## Helper Tests

`tests/helpers/` — Server helper unit tests.

**10 test files** covering all server helpers:

| Helper           | Test files                                          | Coverage                                       |
| ---------------- | --------------------------------------------------- | ---------------------------------------------- |
| **Budget**       | budget.test.ts, budget-helper-coverage.test.ts      | Budget aggregation, profile calculations       |
| **Contribution** | contribution.test.ts, contribution-extended.test.ts | Limit resolution, accumulation logic           |
| **Salary**       | salary.test.ts                                      | Salary queries, transformations                |
| **Mortgage**     | mortgage.test.ts                                    | Amortization, payment calculations             |
| **Settings**     | settings.test.ts                                    | Settings helpers                               |
| **Snapshot**     | snapshot.test.ts                                    | Account snapshot aggregation, balance rollups  |
| **Transforms**   | transforms.test.ts                                  | toNumber, getPrimaryPerson, tax type breakdown |
| **Date**         | date.test.ts                                        | Date utilities                                 |

---

## E2E Tests

`tests/e2e/` — Playwright E2E smoke tests across 9 spec files, 35 tests.

**Setup:** Node.js 20+, install browsers with `pnpm exec playwright install chromium --with-deps`, start dev server.

```bash
pnpm test:e2e                                              # default: http://localhost:3000
PLAYWRIGHT_BASE_URL=http://localhost:3001 pnpm test:e2e    # override base URL
pnpm exec playwright test --headed                         # debug with visible browser
```

**Config** (`playwright.config.ts`): Chromium only, 30s timeout, 1 retry, screenshots/traces on failure. In CI, auto-starts the app via `webServer` config using standalone Next.js server with SQLite + `DEMO_ONLY=true`.

### health.spec.ts

- Home page loads with title
- tRPC endpoint is reachable

### navigation.spec.ts

- Sidebar links present for all main pages
- Can navigate between dashboard pages

### budget.spec.ts

- Budget page loads and renders content
- Table/row structure visible (or graceful empty state)
- No unhandled error overlay

### dashboard.spec.ts

- Dashboard page loads with cards
- Card navigation works

### paycheck-flow.spec.ts

- Paycheck page loads
- Person sections visible or empty state

### projection-overrides.spec.ts

- Retirement projection page loads
- Methodology sub-pages load

### savings-flow.spec.ts

- Savings page loads with fund cards or empty state

### settings-flow.spec.ts

- Settings page renders tab navigation
- No error overlays

### sync-flow.spec.ts

- Portfolio page loads
- Contributions page loads

---

## Testing Patterns

| Pattern                      | Used In                                                                 | Purpose                                                  |
| ---------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| **Snapshot**                 | engine-snapshot, monte-carlo-integration, brokerage-goals               | Detect unexpected output changes after refactoring       |
| **Property-based**           | engine-invariants (fast-check)                                          | Prove invariants hold for any valid input                |
| **Spreadsheet verification** | contribution, paycheck, budget                                          | Lock values to Budget Overview.xlsx                      |
| **Benchmark comparison**     | cfiresim, trinity-study                                                 | Validate against published academic research             |
| **Edge case coverage**       | edge-cases                                                              | Defensive programming (NaN, infinity, zero denominators) |
| **Parameterized**            | asset-assumptions, withdrawal-sensitivity                               | Sweep across parameter ranges                            |
| **Component behavior**       | card, toast, add-item/category-form, dashboard, error-boundary, sidebar | Verify real UI behavior, not just rendering              |
| **Accessibility (axe-core)** | axe                                                                     | Catch missing labels, invalid roles, ARIA issues         |
| **Schema validation**        | zod-schemas                                                             | Verify tRPC input schemas accept/reject correctly        |
| **Router integration**       | All 39 router test files                                                | Test tRPC procedures directly with isolated SQLite DB    |
| **Helper unit tests**        | All 10 helper test files                                                | Test server helpers in isolation                         |
| **E2E smoke**                | 9 Playwright spec files                                                 | Verify app loads and navigates in a real browser         |

### Snapshot Maintenance

When calculator logic changes intentionally (e.g. fixing a formula), snapshots will fail. Update them:

```bash
npx vitest run --update
```

Always review the diff to confirm the change is expected before committing updated snapshots.
