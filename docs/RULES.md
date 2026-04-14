# Ledgr — Rules & Philosophy

## Core Purpose

A unified financial command center for a dual-income household. It answers: **"Are we on track?"** across three horizons:

- **This month:** Is the budget funded? Does every dollar have a job?
- **This year:** Are savings goals progressing? Are we maximizing tax-advantaged space?
- **Long-term:** Will we actually be able to retire? Are we in the right tax buckets?

**Primary user:** Admin (daily dashboard scan). Second user checks occasionally.

---

## Financial Philosophy

Three communities shape the app's design:

**YNAB:** Give Every Dollar a Job. Embrace True Expenses (large infrequent costs broken into monthly savings). Roll With the Punches (multi-tier budgets adapt immediately). Age Your Money (income replacement fund). Integrates with YNAB API for transaction tracking — this app is the strategic layer on top.

**The Money Guy Show:** Financial Order of Operations. Wealth Multiplier (net worth as salary multiple by age). 25% savings rate target. Tax-bucket diversification (Roth / Traditional / After-Tax / HSA) as a first-class feature.

**Bogleheads:** Keep it simple (account-level balances, not individual funds). Stay the course (show the full long-term history). Tax-efficient fund placement. Low costs.

---

## The #1 Design Principle: Adaptability

> Financial situations change, and this app must adapt.

This is the architectural foundation. Every data model, UI component, and calculation must be designed so that change is easy and expected.

1. **Nothing is hardcoded that could change.** Contribution limits, tax brackets, budget categories, savings buckets, account types — all configurable data, never constants in code.
2. **Entities are generic, not special-cased.** Contribution accounts are one generic system — adding a 529 plan is adding a row, not writing new code.
3. **Budget profiles are fully user-created.** Not hard-wired scenarios.
4. **Savings buckets are user-defined.** Users can add, rename, archive, or remove goals.
5. **Retirement scenarios are fully composable.** Different withdrawal rates, target incomes, start years — all mix-and-match.
6. **The calculation engine is modular.** Each calculator takes inputs and returns outputs with no hidden dependencies.
7. **Job changes are a first-class event.** Old job gets an end date, new job starts. Historical data preserved.
8. **Year-over-year limits are versioned.** IRS limits, tax brackets — all keyed by year in the DB.

---

## Rule Scoping

> Rules encode intent, not edge cases. If a rule blocks the right architectural decision, the rule is incomplete — it's missing a boundary condition. Fix the rule, don't work around it or blindly follow it.

Rules that use universal quantifiers ("NEVER", "ALWAYS", "every") without defining their scope will eventually produce wrong decisions at the boundary. When you encounter a conflict between a rule and the right design choice:

1. **Identify the intent** behind the rule — what problem was it preventing?
2. **Identify the scope boundary** — where does the rule's assumption break down?
3. **Update the rule** to document the boundary condition explicitly.
4. **Never silently violate a rule.** Either the rule is wrong and should be updated, or the design choice is wrong and should change. Hidden workarounds compound.

**Example:** "Computed values are NEVER stored" prevents caching stale totals — good intent. But finalized year-end records capture point-in-time state that can't be reconstructed from current data. The rule's assumption (that inputs are always available for recomputation) breaks at the finalization boundary. The fix: update the rule to document the exception, not silently store data in violation.

---

## Data-Driven Architecture

> **Config declares, code executes.** Nothing in the codebase knows what a "401k" is — it only knows how to process an account type with properties like `supportsRothSplit: true` and `balanceStructure: 'roth_traditional'`.

All account-type behavior is defined in `src/lib/config/account-types.ts` (`ACCOUNT_TYPE_CONFIG`). Adding a new account type = adding one config entry. No DB migration, no enum change, no component edits.

### Rules

1. **No category if-chains.** Any code path that branches on account type string must use a config lookup. Direct string comparisons (`=== '401k'`, `.includes('hsa')`) are violations.
2. **No hardcoded category arrays.** Use `getAllCategories()` or filtered variants (`categoriesWithIrsLimit()`, `categoriesWithTaxPreference()`). Never write `['401k', '403b', 'hsa', 'ira', 'brokerage']`.
3. **Display labels live in config modules.** `src/lib/config/display-labels.ts` and `src/lib/config/account-types.ts` own all label maps. Components import — never define local label maps. Performance category strings (`"401k/IRA"`, `"HSA"`, `"Brokerage"`) must reference exported constants from `display-labels.ts`, not inline string literals.
4. **Zod validators derive from config.** Use `z.enum(accountCategoryEnum())` — never `z.enum(['401k', ...])`. All mutations that accept `accountType` must use the config-derived enum, including performance account and portfolio account mutations. No `z.string()` for account type fields.
5. **Balance access uses helpers.** `AccountBalances` is `Record<AccountCategory, AccountBalance>` (discriminated union). Use `getTraditionalBalance()`, `getRothBalance()`, `getTotalBalance()`, `getBasis()` — never literal keys like `acctBal['401k'].traditional`.
6. **parentCategory checks use predicates.** Use `isRetirementCategory()` / `isPortfolioCategory()` — never `parentCategory === "Retirement"` or `=== "Portfolio"` directly. The predicate functions are the single source of truth for classification.
7. **Tax type checks use predicates.** Use `isTaxFree()` and config helpers — never `taxType === "preTax"` or `=== "roth"` directly. Internal engine keys (`preTax`, `taxFree`, `hsa`, `afterTax`) are canonical but must be accessed through helpers, not inline string comparisons.
8. **Display ordering lives in config.** Category tab order, finalize modal sort order, and any other display ordering of account types or performance categories must be defined once in config and imported — never hardcoded as local arrays in components.
9. **Form defaults come from config.** Initial `useState()` values for account type selectors must use `getAllCategories()[0]` or a config-derived default — never `useState("401k")` or other hardcoded category strings.

### Key Files

| File                                      | Role                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/lib/config/account-types.ts`         | Central config record + all derived helpers                                                  |
| `src/lib/config/account-types.types.ts`   | TypeScript types for account config structure                                                |
| `src/lib/config/account-balance.ts`       | Balance structure helpers (traditional, Roth, basis access)                                  |
| `src/lib/config/display-labels.ts`        | Consolidated label maps (tax treatment, method, match, coverage)                             |
| `src/lib/config/tax-tables.ts`            | Federal tax brackets, FICA rates, LTCG graduated brackets                                    |
| `src/lib/config/rmd-tables.ts`            | IRS Uniform Lifetime Table, SECURE 2.0 start ages                                            |
| `src/lib/config/irmaa-tables.ts`          | Medicare Part B+D cliff-based surcharge thresholds                                           |
| `src/lib/config/aca-tables.ts`            | ACA subsidy FPL lookup tables                                                                |
| `src/lib/config/niit.ts`                  | Net Investment Income Tax thresholds                                                         |
| `src/lib/config/budget-template.ts`       | Default budget category structure                                                            |
| `src/lib/config/enum-values.ts`           | Shared enum value arrays for Zod validators                                                  |
| `src/lib/config/glossary.ts`              | Financial term definitions for help tooltips                                                 |
| `src/lib/config/living-costs.ts`          | Cost-of-living data for relocation calculator                                                |
| `src/lib/config/pay-periods.ts`           | Pay frequency definitions and conversion helpers                                             |
| `src/lib/config/withdrawal-strategies.ts` | Spending strategy definitions and metadata                                                   |
| `src/lib/calculators/types.ts`            | `AccountCategory` type (auto-derived from config keys), `AccountBalance` discriminated union |
| `src/lib/constants.ts`                    | App-wide constants (withdrawal rate, wealth score thresholds, FI tolerances)                 |

### Fixing a violation: add the predicate first

When you find a category check (`=== '401k'`, `parentCategory === 'Portfolio'`,
`balanceStructure === 'basis_tracking'`, etc.) that should use a config helper,
**the helper may not exist yet**. Don't reach into `ACCOUNT_TYPE_CONFIG[cat].field`
directly from the call site as a workaround — that just moves the violation. The
correct workflow:

1. Add a small predicate to `src/lib/config/account-types.ts` next to the
   existing helpers (`isPortfolioCategory`, `isOverflowTarget`, etc.). One
   line of doc-comment naming the config field it reads.
2. Export it.
3. Update every call site to use the new predicate.

This keeps the data-driven boundary intact: call sites stay generic, and the
config file remains the only place that knows what each field means.
Examples added during the 2026-04 RULES audit: `isInLimit401kGroup` (reads
`irsLimitGroup === "401k"`), `tracksCostBasis` (reads
`balanceStructure === "basis_tracking"`).

### Contribution Stubs

When a contribution account is created linked to a performance account, inactive stubs are auto-created for all `supportedTaxTreatments` defined in the config. This ensures the UI always shows the full account structure. Components show inactive stubs as dimmed rows.

---

## Engine Modularity

> **Each engine concern lives in its own module.** The projection engine (`lib/calculators/engine/`) is decomposed into 20 focused modules. Never add new logic inline in the orchestrator — extract it into a dedicated module with a clear interface.

The engine was refactored from a single ~3100-line file into a modular architecture. The orchestrator (`projection.ts`) calls modules in an explicit pipeline order. Each module is a pure function with typed inputs and outputs.

### Modules

**Core pipeline** (called by orchestrator in sequence):

- `projection.ts` — Orchestrator: year loop, phase transitions, delegation
- `projection-year-handlers.ts` — Per-year accumulation/decumulation step logic
- `override-resolution.ts` — Sticky-forward config resolution per year
- `contribution-routing.ts` — Accumulation allocation + IRS limits
- `growth-application.ts` — Return rate on all balance structures
- `withdrawal-routing.ts` — Bracket-filling / waterfall / percentage
- `rmd-enforcement.ts` — RMD factor lookup + shortfall distribution
- `post-withdrawal-optimizer.ts` — Roth conversions + IRMAA + ACA
- `tax-estimation.ts` — SS torpedo convergence + gross-up
- `balance-deduction.ts` — Withdrawal deduction, clamping, depletion, dust cleanup
- `balance-utils.ts` — Cloning, conversion helpers
- `individual-account-tracking.ts` — Per-account bookkeeping (contributions, withdrawals, growth)

**Spending strategies** (pluggable via `spending-strategy.ts` dispatcher):

- `spending-strategy.ts` — Strategy dispatcher (selects strategy by name)
- `guyton-klinger.ts` — Dynamic spending guardrails
- `vanguard-dynamic.ts` — Vanguard dynamic spending
- `constant-percentage.ts` — Fixed percentage of portfolio
- `endowment.ts` — Endowment-style spending
- `spending-decline.ts` — Age-based spending decline
- `forgo-inflation.ts` — Skip inflation adjustments
- `rmd-spending.ts` — RMD-based spending floor

### Rules

1. **No new logic in the orchestrator.** `projection.ts` calls modules — it doesn't implement financial logic itself. New features (e.g., a new tax-aware optimization) get their own module.
2. **Explicit pipeline order.** The sequence of operations (contribution routing → growth → withdrawal routing → RMD enforcement → post-withdrawal optimization → balance deduction) is defined in `projection.ts`. Changes to ordering must be intentional and documented.
3. **Module interfaces are contracts.** Each module declares its input type. Callers pass data through the interface — they don't reach into module internals or share mutable state.
4. **Override resolution is centralized.** All per-year sticky-forward config resolution goes through `override-resolution.ts`. No module implements its own override logic.
5. **Balance operations use utilities.** Clone, deduct, grow, and track operations use `balance-utils.ts`, `balance-deduction.ts`, `growth-application.ts`, and `individual-account-tracking.ts`. Never inline balance math in the orchestrator or other modules.

### Public API

Four function exports + one type from `engine/index.ts`:

- `calculateProjection()` — Full accumulation + decumulation
- `estimateEffectiveTaxRate()` — Effective tax rate for a given income
- `incomeCapForMarginalRate()` — Income cap for a target marginal bracket
- `computeTaxableSS()` — Taxable portion of Social Security benefits

All other modules are internal — not imported outside `engine/`.

---

## The Holistic Rule

> Everything interacts with everything as a holistic plan unless specifically called out as a scenario.

All pages, calculators, and routers share a single, consistent view of the user's financial state. One salary, one budget, one set of contributions, one portfolio — every page reads from the same source.

### Single Computation Path

> For any metric displayed in the app, there must be exactly ONE code path that produces it. If a value can be reached through more than one computation path, those paths WILL eventually diverge — through different inputs, different formulas, different assumptions, or different data freshness. The fix is always the same: one computation, one source, all consumers read from it.

**Test**: Pick any number shown in the UI. Trace it back to its computation. If you find two different code paths that could produce this value (even if they currently give the same answer), that's a bug waiting to happen. Collapse them into one.

### Historical as Single Source of Truth

> All year-level financial data flows through `buildYearEndHistory()`. Finalized years read from `net_worth_annual`. The current year is built from live snapshot/performance/settings data. No procedure should independently query snapshot, cash, mortgage, or salary data for year-level computations — read from `YearEndRow` instead.

**Data flow:**

```
Portfolio Snapshots + Performance Data + Settings
        ↓ (finalization writes to net_worth_annual)
    net_worth_annual (finalized years — authoritative)
        ↓
    buildYearEndHistory() (adds current year from live data)
        ↓
    ALL year-level reads: Trends, Historical, Dashboard, Comparisons
```

**Exceptions** (must be documented and justified):

- `computeComparison` uses arbitrary-date snapshots (not year-end aligned)
- Retirement projection engine uses live data for forward projections
- Contribution router uses live payroll data (not year-level)
- Performance router is the source/editor — it writes to the tables that `buildYearEndHistory` reads

### Shared State Sources

| Data                      | Source                               | Key                                                            |
| ------------------------- | ------------------------------------ | -------------------------------------------------------------- |
| Year-level financial data | `buildYearEndHistory()`              | `YearEndRow` from `net_worth_annual` + live current year       |
| Tax location breakdown    | `YearEndRow.portfolioByTaxLocation`  | JSONB on `net_worth_annual` (finalized) / snapshot (current)   |
| Budget column             | `app_settings`                       | `budget_active_column`                                         |
| Annual expenses           | `getAnnualExpensesFromBudget()`      | Uses `budget_active_column`                                    |
| Current salary            | `getCurrentSalary()`                 | `salary_changes` → `jobs.annual_salary` fallback               |
| Portfolio balances        | `getLatestSnapshot()`                | Latest `portfolio_snapshots` row                               |
| Contribution accounts     | `buildContribAccounts()`             | `contribution_accounts` table                                  |
| Contribution specs        | `buildContributionDisplaySpecs()`    | Per-account specs with match redistribution                    |
| Category aggregations     | `aggregateContributionsByCategory()` | Contribution + match totals per account category               |
| Account type config       | `getAccountTypeConfig()`             | All account-type behavior (from `ACCOUNT_TYPE_CONFIG`)         |
| Parent category map       | `getParentCategory()`                | Account type → goal category (Retirement/Portfolio) via config |
| Mortgage balance          | `computeMortgageBalance()`           | Amortization from loans + extra payments                       |

### Rules

1. **No hardcoded fallbacks for user-specific data.** If data doesn't exist, return 0 — don't invent a number. Universal defaults (4% withdrawal rate, IRS limits) are acceptable if stored in DB.
2. **One budget column controls everything.** `budget_active_column` determines which scenario is active across all pages.
3. **Scenarios are explicit opt-ins.** Override controls are clearly labeled as "what-if", not hidden divergences.
4. **Shared helpers, not duplicated queries.** Use `helpers.ts` when multiple routers need the same derived value.
5. **Age and personal data come from the `people` table.** Never hardcode ages or personal details.

### Violations to Watch For

- A router computing budget expenses with a different column index
- A page showing salary that doesn't come from `getCurrentSalary()`
- A fallback value that silently replaces missing data
- Two routers fetching the same data independently
- A "what-if" override that leaks into non-scenario calculations
- A metric (wealth score, FI progress, tax location, etc.) computed via different code paths on different pages
- A router calling `getLatestSnapshot()` for year-level data instead of reading from `buildYearEndHistory()`
- A procedure computing mortgage balance, cash, or salary independently when `YearEndRow` already provides it
- Tax location data derived from account type config instead of stored/snapshot data
- A component or router with `if (category === '401k')` or similar string check
- A local label map duplicating what exists in `src/lib/config/`
- A hardcoded `['401k', '403b', 'hsa', 'ira', 'brokerage']` array instead of `getAllCategories()`
- A new account type requiring code changes beyond one config entry
- A router or component using `displayName ?? accountLabel` inline instead of `accountDisplayName()`
- A component appending `(Owner)` suffix separately — owner is already in `accountLabel`
- A direct read of `perf.accountLabel` for display instead of `accountDisplayName(perf)`
- Snapshot rows displayed flat instead of grouped by performance account
- Sub-row showing raw `accountType` (e.g., "ira", "brokerage") when `subType` ("Rollover", "Employer Match") is available
- Owner name shown on every sub-row instead of only on joint accounts with multiple owners
- New financial logic added directly in `engine/projection.ts` instead of a dedicated module
- An engine module importing from another engine module's internals instead of using the barrel export
- Override logic implemented inline in a module instead of using `override-resolution.ts`
- Balance manipulation without using `balance-utils.ts` / `balance-deduction.ts` utilities
- `parentCategory === "Retirement"` instead of `isRetirementCategory()`
- `taxType === "preTax"` or `=== "roth"` instead of config predicates (`isTaxFree()`, etc.)
- Hardcoded performance category strings (`"401k/IRA"`, `"HSA"`, `"Brokerage"`) instead of constants from `display-labels.ts`
- A hardcoded category sort order in a component instead of importing from config
- `useState("401k")` or other hardcoded account type defaults in form components
- Inline `.toFixed(N) + '%'` or `'$${n/1000}k'` instead of `formatPercent()` / `compactCurrency()`
- A mutation using `z.string()` for financial amounts instead of `zDecimal`
- A mutation using `z.string().min(1)` for `accountType` instead of `z.enum(accountCategoryEnum())`
- A helper function calling `new Date()` internally when it should accept `asOfDate` as a parameter
- A UI permission check (`hasPermission`) that doesn't match the router procedure type
- An API route that bypasses `DEMO_ONLY` checks
- A numeric fallback (`0.04`, `0.07`, `200000`) that doesn't reference its constant from `constants.ts`
- Stored computed values without a documented sync/cascade mechanism

---

## Global Scenario System

**Main Plan** = the real database state. Editing in Main Plan changes real data.

**Scenario** = a named collection of overrides layered on top. Overrides are diffs, not copies.

**View Mode** = global toggle between "Projected Year" and "Actual YTD".

### How Scenarios Work

1. No nested scenarios — flat overlay on main plan.
2. In Main Plan, pages retain local temp changes (budget toggle, retirement sliders).
3. In a Scenario, edits become overrides (write to override map, not DB).
4. Overrides propagate holistically through shared helpers.
5. Persistence is user's choice (DB-persisted or session-only).

### Override Structure

```json
{
  "jobs": { "1": { "annualSalary": "180000" } },
  "contributionAccounts": { "3": { "contributionValue": "10" } },
  "appSettings": { "budget_active_column": 2 },
  "retirementAssumptions": { "returnRate": "0.07", "retirementAge": "62" }
}
```

### Data Flow

```
Main Plan (DB) → tRPC query → ScenarioContext applies overrides → Page renders
                                    ↑
                          Active scenario overrides (JSONB or React state)
```

---

## Data Model Principles

1. **Person-centric, not employer-centric.** A person has jobs. Jobs change. The person persists.
2. **Generic over specific.** Contribution accounts, savings goals, budget categories — all user-definable.
3. **Snapshots for history, settings for current state.** Time-varying data gets point-in-time records.
4. **Computed values are not stored — with documented exceptions.** Live totals, percentages, and projections are recalculated from source data at read time. **Exceptions** (stored because inputs may not survive):
   - **`net_worth_annual`** — finalized year-end records capture point-in-time state (tax location breakdown from a Dec 31 snapshot that may later be pruned).
   - **`annualReturnPct`** — stored on finalized `annual_performance` and `account_performance` rows. Immutable after finalization. Recomputed on-read for non-finalized years.
   - **`lifetimeGains`, `lifetimeContributions`, `lifetimeMatch`** — cumulative fields on `annual_performance`. Computed at finalization from previous year's baseline. **Cascade rule:** when `account_performance` rows on a finalized year are edited, lifetime fields on the annual row and all subsequent years must be recomputed. Without cascade, corrections to historical data create silent drift in all forward lifetime totals.

   If the inputs are preserved and the computation is deterministic, compute at read time. If the inputs may not survive (snapshots pruned, accounts restructured), store at finalization — but document the sync/cascade mechanism.

5. **Limits and rules are data, not code.** IRS limits, tax brackets, return rates — all in the DB, versioned by year.
6. **DB is the single source of truth.** No hardcoded fallback values for user-specific data. Universal mathematical defaults (`DEFAULT_WITHDRAWAL_RATE = 0.04`, `DEFAULT_TAX_RATE_*` in `constants.ts`) are acceptable as they represent well-established financial planning conventions, not user data.
7. **Standardized naming.** Tax buckets use canonical keys everywhere: `preTax`, `taxFree`, `hsa`, `afterTax`. Display labels are applied at the UI layer via lookup maps. `parentCategory` (not `goalCategory`) is the unified field name across all tables.
8. **No hardcoded user data.** Never reference specific names, employers, job titles, or other user-specific data in code. Everything comes from the DB. The app must work for any household, not just the current users.
9. **Account type validation is app-level, not DB-level.** `accountType` columns are `text` (not enum), validated at the app layer against `ACCOUNT_TYPE_CONFIG` keys via `accountCategoryEnum()`. This allows adding new account types without DB migrations.
10. **Programmatic account naming.** `accountLabel` is server-computed via `buildAccountLabel()` from `format.ts`: `{Owner} {Label?} {SubType || Type} ({Institution})`. `displayName` is an optional user override. All display uses `accountDisplayName()` — never inline `displayName ?? accountLabel` or direct field reads. Owner is baked into the label; components must NOT append owner separately.

### Account Categories

Two `parentCategory` values classify all investment accounts by their goal:

| Category       | Account Types        | Used For                                                    |
| -------------- | -------------------- | ----------------------------------------------------------- |
| **Retirement** | 401k, 403b, IRA, HSA | Retirement projections, contribution engine                 |
| **Portfolio**  | Brokerage            | Portfolio totals only; excluded from retirement projections |

Each account type has a default `parentCategory` in `ACCOUNT_TYPE_CONFIG` (brokerage defaults to Portfolio, retirement accounts default to Retirement). The `parentCategory` is user-editable per account in the Portfolio page and controls all routing — retirement projections include only Retirement-category accounts, the brokerage page shows only Portfolio-category accounts. The config default determines the initial assignment, but `parentCategory` is the single source of truth for behavior.

**Note:** ESPP, Rollover, Employer Match, Profit Sharing are **sub-types** (`subType` field) of their parent account type — not separate account categories. The 5 account categories are: `401k`, `403b`, `ira`, `hsa`, `brokerage`. Sub-types are defined per account type in `ACCOUNT_TYPE_CONFIG.subTypeOptions`.

**Retirement ⊂ Portfolio.** Portfolio means ALL accounts. Retirement is the subset used for retirement projections. Every account either rolls up directly to Portfolio or into Retirement (which is included in Portfolio).

**Single source of truth:** `getParentCategory()` from `src/lib/config/account-types.ts`. It reads the `parentCategory` config property for each account type. Contribution and retirement routers use this for page-level filtering (which page owns the account).

#### Performance page display categories

The Performance page uses a **separate grouping** based on `accountType` from the `performance_accounts` master table — not `parentCategory`. This groups accounts by what they _are_, not their goal:

| Display Category | Account Types                                        | Derived From                |
| ---------------- | ---------------------------------------------------- | --------------------------- |
| **Brokerage**    | All brokerage accounts (Long Term, Retirement, ESPP) | `accountType = 'brokerage'` |
| **HSA**          | All HSA accounts                                     | `accountType = 'hsa'`       |
| **Retirement**   | 401k, 403b, IRA                                      | Everything else             |
| **Portfolio**    | All accounts combined                                | Sum of all categories       |

This mapping is defined in `accountTypeToCategory()` in `performance.ts`. Annual rollup rows (`annual_performance.category`) and account filtering both use this grouping. For `account_performance` rows without a `performanceAccountId`, the system falls back to matching by `institution + accountLabel` against the master table, then to the stored `parentCategory`.

**Where numbers appear:**

- **All accounts (Portfolio):** Net Worth page, Net Worth dashboard card, Portfolio page, Performance page
- **Retirement-only:** Retirement page, Retirement dashboard card, contribution engine projections
- **By account type:** Performance page tabs, Historical page `portfolioByType` breakdown

**Data freshness:** Balance snapshot and performance data are updated manually at different times. A global sidebar indicator shows when each was last updated. Totals may differ between pages because of stale data — this is expected and visible.

**User-editable:** `parentCategory` is editable per account in the Portfolio page and in Settings → Performance Accounts. Users assign each account's "goal" (Retirement or Portfolio). This affects contribution engine routing and retirement projections, but does **not** affect Performance page tab grouping (which uses `accountType`).

### Drizzle ORM Conventions

- **NOT NULL** on every financial amount column unless explicitly nullable
- **Decimal precision:** `decimal(12,2)` for dollars, `decimal(12,6)` for rates
- **Enums:** All enum fields use `pgEnum()` for DB-level validation
- **JSONB:** Use `.$type<T>()` for type inference
- **ON DELETE:** Default `RESTRICT`; `CASCADE` only for tightly coupled parent-child
- **Indexes:** Explicit indexes on all FK columns (PostgreSQL doesn't auto-create them)

---

## Settings Belong on Their Pages

> All settings should be controlled on the individual pages that use them, not on a centralized Settings page.

Each page owns its domain data. Users should never have to leave a page to configure its behavior.

| Data                                               | Managed On               |
| -------------------------------------------------- | ------------------------ |
| Retirement ages, rates, scenarios                  | Retirement page (inline) |
| Contribution accounts, deductions                  | Paycheck page (inline)   |
| Current job salary changes                         | Paycheck page (inline)   |
| Mortgage loans, extra payments                     | Mortgage page            |
| Cash, house value, home improvements, other assets | Assets page              |
| Savings goals, allocations                         | Savings page             |
| Performance accounts                               | Performance page         |
| Full job/salary history                            | Historical page          |
| ESPP gain calculator, Relocation calculator        | Tools page               |

**Exceptions (centralized Settings page):**

- **People** (name, DOB) — foundational identity used across all pages
- **IRS Limits** — yearly reference data (401k/IRA/HSA caps, FICA rates, standard deductions)
- **Tax Brackets** — yearly, multi-filing-status reference data

These are true cross-cutting reference data that no single page owns.

---

## Coding Conventions

- **Pure calculators.** `lib/calculators/` contains pure functions only — no DB, no tRPC, no React. Given the same inputs, always the same outputs. The engine is a modular subdirectory (`lib/calculators/engine/`) with 20 focused modules — see § "Engine Modularity".
- **tRPC routers are the bridge.** They fetch from Drizzle, convert decimal strings to numbers via `toNumber()`, call calculators, return results.
- **tRPC verb prefixes:** `get*` — single stored item or current state; `list*` — collection/array result; `compute*` — derived calculation or aggregation. Never use `get*` for procedures that aggregate or compute.
- **Variable naming — no abbreviations.** Use full names: `percent` not `pct`, `amount` not `amt`, `account` not `acct`, `year` not `yr`, `index` not `idx`, `month` not `mo`. Existing abbreviations are migrated incrementally when files are touched for other reasons.
- **Type suffix conventions:** `*Props` for React component props; `*Input` / `*Result` for procedure/calculator I/O types; `*Config` / `*Options` for settings and configuration objects; domain nouns (no suffix) for data shapes (e.g. `DeductionLine`, `BudgetMatch`).
- **Components never import from `server/`.** They consume data via tRPC hooks.
- **Three state layers:** Server state (React Query via tRPC), Form state (React Hook Form), UI state (`useState`).
- **Formatting — zero exceptions.** Use `formatCurrency()`, `formatPercent()`, `compactCurrency()`, `formatDate()` from `@/lib/utils/format`. **Never** inline formatting — this includes chart axis tick formatters, tooltip renderers, and input display formatters. If the canonical function doesn't support your precision needs, extend the function (e.g., `formatPercent(value, decimals)` already accepts a decimals argument) — don't bypass it. Inline `.toFixed(N) + '%'` and `'$${n/1000}k'` are violations.
- **Colors:** Use centralized helpers from `@/lib/utils/colors.ts`. Never hardcode colors for account/tax types.
  - **Account types** (401k, 403b, IRA, HSA, Brokerage): `accountColor()` (bg fill), `accountMatchColor()` (light fill), `accountBorderColor()` (left border), `accountTextColor()` (text)
  - **Tax treatments** (preTax, taxFree, hsa, afterTax): `taxTypeColor()` (bg fill for bars), `taxTypeTextColor()` (text for labels/cells)
  - UI badges (BG, PC, etc.) must NOT use account-type colors — use indigo or gray to avoid overlap.
- **Math:** Use `safeDivide()`, `roundToCents()`, `sumBy()` from `@/lib/utils/math.ts`.
- **Shared components:** `EmptyState`, `HelpTip`, `AccountBadge`, `PageHeader`, `LoadingCard`, `ErrorCard`, `ContribPeriodToggle`.
- **Account type config:** `src/lib/config/account-types.ts` is the single source for all account-type behavior. Use `getAccountTypeConfig()`, `getAllCategories()`, `isOverflowTarget()`, `categoriesWithIrsLimit()`, etc. — never hardcode category checks.
- **Display labels:** Import from `src/lib/config/display-labels.ts`. Never define local label maps in components.

### Refactoring: LOC vs per-file size

"Too many lines" is two separate problems with separate fixes — don't conflate them in a refactor plan:

- **Total LOC** is reduced by dead-code sweeps (`ts-prune`), parameterized test compression, and flattening premature abstractions. Realistic ceilings are small (~5% at current size) and often not worth the churn.
- **Per-file size** is the real reviewability problem. Files over ~1,500 lines hurt cognitive load. The fix is splitting into focused modules. Splitting _increases_ total LOC slightly (new imports, prop types) but is the right trade.

"Split large files" does not reduce total LOC. "Delete dead code" does not reduce per-file size. Different problems, different plans.

**Prerequisite for any file split:** add smoke tests for the target file first — mount with mocked tRPC, assert key elements present, one mutation-plumbing test per page. The refactor needs a safety net.

---

## Mutation Hook Convention

> **Mutation hooks return a flat shape.** tRPC already namespaces mutations under the procedure name; a `{ mutations, invalidate }` wrapper adds indirection without value.

### Rules

1. **Flat return shape.** A mutation hook returns individual named mutators directly: `{ createX, updateX, deleteX, isPending }`. Never `{ mutations: { ... }, invalidate: () => void }`.
2. **Domain-specific naming.** Hook names follow `use<Domain>Mutations` where `<Domain>` is specific enough to be unambiguous globally — `useBudgetItemMutations`, not `useBudgetMutations` (collides with a hypothetical budget-level hook). Integrations hooks that share a domain with a page-level hook must disambiguate: `useBudgetIntegrationsMutations`.
3. **No parent-state callbacks.** Mutation hooks own data — they must not accept callbacks that manage parent UI state (e.g., `onItemCreated: () => setAddingItem(null)`). The caller chains via `.mutateAsync()` or observes `createX.isSuccess`. Keeping UI state in the parent and data mutations in the hook maintains clean separation.

---

## Constants & Defaults

> **Every numeric default lives in exactly one place.** If a fallback value appears in more than one file, it must be extracted to `src/lib/constants.ts` and imported everywhere. Inline magic numbers are violations — even when they match the constant's current value.

### Rules

1. **One definition per default.** Financial defaults (withdrawal rate, return rate, inflation rate, tax rates) are defined once in `src/lib/constants.ts`. All consumers import from there. No `0.04` or `0.07` scattered across files as fallbacks.
2. **UI threshold constants live in constants.ts too.** Behavioral thresholds (high income threshold, IRMAA start age, etc.) that affect display logic must be centralized, not hardcoded per-component.
3. **DB schema defaults must match code constants.** If a DB column has a `.default("0.04")`, the value must come from the same constant that code fallbacks reference. If the constant changes, both change.
4. **Demo profiles are exceptions.** Demo seed data may use varied values (different inflation rates per profile) — these are intentional per-profile variation, not default definitions.

---

## Validation Consistency

> **Every write path to the same table must enforce the same constraints.** If one mutation validates `accountType` with `z.enum()` and another accepts `z.string()`, the second mutation is a hole in the validation layer.

### Rules

1. **Financial amounts use `zDecimal`.** All tRPC mutations that write decimal/currency columns must use the shared `zDecimal` validator from `_shared.ts` — never bare `z.string()`. This applies to performance, portfolio, budget, and all other domain mutations.
2. **Account type uses config enum.** Every mutation that accepts `accountType` must use `z.enum(accountCategoryEnum())`. No `z.string().min(1)` on account type fields.
3. **Shared schemas for shared tables.** When multiple mutations write to the same table, extract the field validators into a shared schema or compose from shared field definitions. Don't define independent schemas with different constraints.
4. **Year fields are bounded.** All year inputs should use `z.number().int().min(1900).max(2100)` or similar reasonable bounds — not bare `z.number()`.

---

## Time Resolution

> **"Now" is resolved once per request and passed through.** Every function in a request chain must receive its reference date as a parameter — never call `new Date()` independently. Two `new Date()` calls in the same request can disagree on the date, especially at year boundaries.

### Rules

1. **Routers resolve once.** Each tRPC procedure resolves `const asOfDate = new Date()` (or from snapshot date) once at the top. All downstream function calls receive this date as a parameter.
2. **Helpers accept asOfDate.** Functions like `buildYearEndHistory()`, `getEffectiveOtherAssets()`, and `isPriorYearContribWindow()` must accept an `asOfDate` parameter with a `= new Date()` default for backward compatibility. They must never call `new Date()` internally.
3. **Calculator inputs require asOfDate.** All calculator input types already include `asOfDate: Date`. This is enforced by TypeScript — maintain it.
4. **No stray `new Date()` in called functions.** If a function is called from a router that already resolved a date, the function must use the passed date — not create its own.

---

## Permission & Security Gates

> **Every write path goes through the same permission gate.** If the UI shows a button gated by permission X, the tRPC mutation behind it must use the same permission. Mismatches create confusing UX (visible buttons that fail on click) or security gaps (accessible mutations with no UI check).

### Rules

1. **UI permission must match router procedure.** If a component checks `hasPermission(user, "brokerage")`, the mutation it calls must use `brokerageProcedure` (not `adminProcedure` or `protectedProcedure`). Mismatches in either direction are bugs.
2. **Demo mode blocks all write paths.** The `demoOnlyGuard` middleware blocks tRPC mutations. Non-tRPC API routes (`/api/versions/import`, `/api/versions/export`, etc.) must independently check `process.env.DEMO_ONLY` and return 403 — they bypass tRPC middleware.
3. **No unprotected writes.** Every mutation that modifies _shared application data_ must use a domain-specific procedure (`budgetProcedure`, `performanceProcedure`, etc.) or `adminProcedure`. `protectedProcedure` is for reads only.

   **Exception — session/sandbox mutations.** Mutations in `demo.*` may use `protectedProcedure` because (a) they manage HttpOnly cookie state, not application data, or (b) they write to per-user isolated demo schemas, never to shared data, and (c) they must remain callable in DEMO_ONLY mode where the `demoOnlyGuard` middleware exempts demo paths. Demo users are not admins, so `adminProcedure` would break the flow. Each such mutation must carry an inline comment justifying the exception.
