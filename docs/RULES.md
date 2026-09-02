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

## Pure Business Logic Boundary

**All business logic must live in `src/lib/pure/` — never inside database transactions, API handlers, or router procedures.** This is a hard architectural rule, not a style preference: `better-sqlite3` cannot use async transactions, and coupling logic to I/O makes it untestable regardless of database.

1. **Pure functions** (`src/lib/pure/`): compute values, validate rules, resolve limits, transform data. No imports from `@/lib/db`, `drizzle-orm`, or any I/O module. Import helpers only from specific submodules (e.g. `@/server/helpers/transforms`), never from barrel re-exports that pull in DB code.
2. **Routers/handlers** (`src/server/routers/`): fetch data, call pure functions, persist results. Thin wrappers only — if you're writing an `if` or a `for` loop that computes a value, it belongs in a pure function.
3. **Tests** (`tests/pure/`): every pure function gets a unit test that runs without any database, network, or environment setup.

**How to tell if logic is in the wrong place:** it's in a `.transaction()` callback; it's in a `protectedProcedure` handler doing math/validation/aggregation; it needs `import * as schema` or `import { eq } from "drizzle-orm"` to work; or it can't be tested without mocking the database.

Full contributor-facing writeup (existing pure modules table, import-discipline examples) lives in `CONTRIBUTING.md` § Pure Business Logic Boundary — this section is the authoritative rule; that one is the onboarding-friendly version. Keep them consistent if either changes.

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

| Data                               | Source                               | Key                                                                                                                                                                                                                                                         |
| ---------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Year-level financial data          | `buildYearEndHistory()`              | `YearEndRow` from `net_worth_annual` + live current year                                                                                                                                                                                                    |
| Tax location breakdown             | `YearEndRow.portfolioByTaxLocation`  | JSONB on `net_worth_annual` (finalized) / snapshot (current)                                                                                                                                                                                                |
| Budget column                      | `app_settings`                       | `budget_active_column`                                                                                                                                                                                                                                      |
| Annual expenses                    | `getAnnualExpensesFromBudget()`      | Uses `budget_active_column`                                                                                                                                                                                                                                 |
| Total compensation (profile-aware) | `resolveCompensation()`              | `server/helpers/salary.ts` — the single place salary+bonus is computed under a Salary Profile entry                                                                                                                                                         |
| Salary override merge              | `applyActiveSalary()`                | Final `active ?? raw` merge of the Plan/session override onto an already-resolved raw salary                                                                                                                                                                |
| Salary override map                | `loadAndApplySalaryProfile()`        | Plan/session pins, then the active Salary Profile's entries                                                                                                                                                                                                 |
| Portfolio balances                 | `getLatestSnapshot()`                | Latest `portfolio_snapshots` row                                                                                                                                                                                                                            |
| Contribution accounts              | `buildContribAccounts()`             | `contribution_accounts` table                                                                                                                                                                                                                               |
| Employer match                     | `computeGroupedEmployerMatch()`      | Combines Roth/Traditional splits of one account before applying the match cap once; every consumer (`buildContribAccounts`, `buildContributionDisplaySpecs`, `aggregateContributionsByCategory`, `retirement.ts`'s scenario comparison) routes through this |
| Contribution specs                 | `buildContributionDisplaySpecs()`    | Per-account specs, incl. match via `computeGroupedEmployerMatch()`                                                                                                                                                                                          |
| Category aggregations              | `aggregateContributionsByCategory()` | Contribution + match totals per account category, incl. match via `computeGroupedEmployerMatch()`                                                                                                                                                           |
| Account type config                | `getAccountTypeConfig()`             | All account-type behavior (from `ACCOUNT_TYPE_CONFIG`)                                                                                                                                                                                                      |
| Parent category map                | `getParentCategory()`                | Account type → goal category (Retirement/Portfolio) via config                                                                                                                                                                                              |
| Mortgage balance                   | `computeMortgageBalance()`           | Amortization from loans + extra payments                                                                                                                                                                                                                    |

### Rules

1. **No hardcoded fallbacks for user-specific data.** If data doesn't exist, return 0 — don't invent a number. Universal defaults (4% withdrawal rate, IRS limits) are acceptable if stored in DB.
2. **One budget column controls everything.** `budget_active_column` determines which scenario is active across all pages.
3. **Scenarios are explicit opt-ins.** Override controls are clearly labeled as "what-if", not hidden divergences.
4. **Shared helpers, not duplicated queries.** Use `helpers.ts` when multiple routers need the same derived value.
5. **Age and personal data come from the `people` table.** Never hardcode ages or personal details.
6. **Grep before reimplementing a documented rule.** Before writing a display rule, derived formula, or label mapping that plausibly already exists (check DESIGN.md and grep for similarly-named components/hooks first), find and reuse the existing implementation rather than writing a second one from the spec. Two independent implementations of the same rule will diverge — this is how the sub-row label rule, tax-type labels, and the household savings-rate formula each shipped real bugs after being written twice.

### The Salary Profile layer

`jobs` carries no compensation, schedule, W-4, or extra-paycheck-routing
data of its own any more — it is pure identity/lifecycle (`id`, `personId`,
`startDate`, `endDate`, `isSpeculative`, `employerName`, `title`). Every
number and election a job needs for a live calculation comes from a
**Salary Profile**: `salary_profiles.salaries` maps `jobId` (string key) to
a **complete, 17-field entry**:

```ts
type SalaryProfileEntry = {
  salary: number;
  bonusPercent: number; // fraction, 0.12 = 12%
  bonusMultiplier: number;
  monthsInBonusYear: number;
  bonusOverride: number | null; // this year's actual paid-out bonus, pinned
  payPeriod: PayPeriod;
  payWeek: PayWeek;
  anchorPayDate: string | null; // null = "no anchor, use startDate" — a real, complete value
  budgetPeriodsPerMonth: number | null;
  w4FilingStatus: W4FilingStatus;
  w4Box2cChecked: boolean;
  additionalFedWithholding: number;
  bonusMonth: number | null;
  bonusDayOfMonth: number | null;
  include401kInBonus: boolean;
  includeBonusInContributions: boolean;
};
```

> **A job either has ALL 16 fields in a given profile, or none at all.**

There is no partial-pin state, no per-field presence check, and no "resolves
live from the job record" fallback — a job has nothing left on `jobs` to
fall back to. A profile that doesn't mention a job says **nothing** about
it: salary/bonus resolve to $0/no bonus, and every other field resolves to
`undefined`, which every consumer must treat as a real "incomplete" signal
(see `mergeSalaryProfileJobFields`/`resolveContribPeriods`'s pattern of
excluding rather than guessing) — never a substitute for a live column,
because none exists. `salaryEntrySchema` (`json-schemas.ts`) is `.strict()`
so a partial or stale-shaped entry is rejected at write time, not silently
stored and later misread.

**This collapses two axes that used to be independent** (accepted per the
project owner's explicit direction, not a silent side effect): "how much do
I earn" and "what withholding/schedule elections apply" are now the same
Salary Profile fact. If you want a different W-4 election or pay schedule
without changing income, that still requires a different Salary Profile (or
a different entry within one) — there is no way to vary only one axis
independently of the other.

**One definition of compensation.** `resolveCompensation()` in
`server/helpers/salary.ts` is the single place salary-plus-bonus is computed
under a profile entry, and `resolveProfile`, `build-engine-payload`, and the
`salaryProfile.getById` editor preview all go through it. They previously
re-derived it separately and disagreed. Do not add a fourth derivation.
`mergeSalaryProfileJobFields()` is the equivalent single place for merging
the other 11 fields onto a job object — every router that needs
`payPeriod`/`w4FilingStatus`/etc. on a job calls this rather than
re-deriving the merge.

**Contribution Profile no longer touches jobs at all.** The `jobs`
active-fields bucket that used to let a Contribution Profile override
`employerName`/bonus-pay-date/bonus-inclusion-flags is deleted wholesale —
`contributionActiveFieldsSchema` has only `contributionAccounts` and
`deductions` buckets now. Two consequences, both intentional:

1. **`employerName`'s profile-override capability is gone**, not preserved
   elsewhere. Modeling "a different employer, same everything else" via a
   named override is no longer supported — modeling a genuinely different
   job means creating a new `jobs` row, which already carries its own
   `employerName`. A real feature reduction, not a bug.
2. **The permission gate for W-4/schedule/bonus-date fields moved.** These
   used to be admin-only (raw `jobs.update`, `adminProcedure`). They're now
   part of a Salary Profile entry, written through
   `salaryProfile.create`/`update` (`contributionProfileProcedure`) — no
   longer admin-gated. Anyone who could already edit a Contribution Profile
   can now set these for any job.

**`paycheck_deductions` has no live amount of its own either** —
`amount_per_period` was dropped the same way `contribution_accounts` lost
its base contribution value. A deduction's dollar amount resolves ONLY via
a Contribution Profile's `deductions` active-field entry
(`applyDeductionActiveFields`), same no-base-value, exclude-if-absent rule
`applyContribActiveFields` already uses for contribution accounts.

### Violations to Watch For

- A router computing budget expenses with a different column index
- A page showing salary/pay-schedule/W-4 data that doesn't come from a
  Salary Profile entry via `resolveCompensation()` /
  `mergeSalaryProfileJobFields()` (profile-aware) — `jobs` has no such
  columns left to read
- A pinned salary being treated as excluding bonus, or total compensation
  computed anywhere other than `resolveCompensation()`
- Any field of `SalaryProfileEntry` reappearing in a Contribution Profile
  active-field bucket — the `jobs` bucket there is deleted, only
  `contributionAccounts`/`deductions` remain
- A salary figure displayed as a Contribution Profile statistic
- A job's `payPeriod`/`w4FilingStatus`/etc. treated as `undefined` meaning
  the same thing as `0`/`false`/a guessed default, instead of "incomplete —
  exclude, don't guess"
- A fallback value that silently replaces missing data
- Two routers fetching the same data independently
- A "what-if" override that leaks into non-scenario calculations
- A metric (wealth score, FI progress, tax location, etc.) computed via different code paths on different pages
- A router calling `getLatestSnapshot()` for year-level data instead of reading from `buildYearEndHistory()`
- A procedure computing mortgage balance, cash, or salary independently when `YearEndRow` already provides it
- Tax location data derived from account type config instead of stored/snapshot data
- A component or router with `if (category === '401k')` or similar string check
- A local label map duplicating what exists in `src/lib/config/`
- A `{ MFJ: <figure>, Single: <figure>, HOH: <figure> }` tax-figure table (rates, thresholds, bracket data) declared outside `src/lib/config/` instead of imported from a config module (R43 — `tests/lint/violations.test.ts` rule 23)
- A local `const` re-declaring an ALL_CAPS name already exported from `src/lib/constants.ts` or a `src/lib/config/` module, instead of importing it (R43 — rule 24)
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
- Business logic (math, validation, aggregation) written inline in a `.transaction()` callback or a router procedure handler instead of extracted to `src/lib/pure/`
- A display rule, label mapping, or formula reimplemented in a second component instead of importing the existing function
- A local hex/Tailwind color value for a chart series or a status/severity indicator instead of an export from `colors.ts`
- A new `lib/pure/` function, hook, or `components/ui/` primitive merged with zero call sites

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

### Lever Order

The three profile-driven "levers" have a real dependency chain, and pages/UI
ordering should follow it: **Contributions → Budget → Savings**. Contribution
elections (+ salary) determine take-home pay; the Budget consumes that
take-home pay and leaves a monthly surplus/deficit; Savings allocations spend
whatever the Budget leaves over. Changing an earlier lever changes every
later one's numbers — the reverse is never true. This is why the Budget
page's tabs are ordered Contributions, Budget, Savings rather than
alphabetically or by table-creation order.

### Profile Pins (a second, deliberately separate mechanism)

A Scenario can also **pin** which Budget Profile / Contribution Profile /
Salary Profile is "active" while it's selected — e.g. "under this Plan,
always use my Chicago-relocation budget profile." This is a _reference_, not
a value diff, so it does **not** live in the `overrides` JSONB bucket above.
Instead `scenarios` carries three nullable FK columns, `budget_profile_id`,
`contribution_profile_id`, and `salary_profile_id` (all `onDelete: "set
null"`), each with an explicit index — the same shape as
`retirement_salary_overrides.contributionProfileId` /
`.salaryProfileId`. The Contribution and Salary axes are **independent**: a
Plan can pin either, both, or neither.

Precedence when resolving "which profile is active" (see
`useEffectiveProfileId`): **Plan pin → per-budget-column pin → local page
selection → globally-active profile.** The per-column tier only exists on the
budget page's columns: `budget_profiles.column_contribution_profile_ids` /
`.column_salary_profile_ids` are same-length-as-columns arrays resolved
exclusively through `resolveContributionProfileId` / `resolveSalaryProfileId`
(`lib/calculators/contribution-profile-resolution.ts`) — server-side budget
item $ computation and client-side payroll display must call the same
resolver for the same column or the two numbers on screen silently disagree.

Those resolvers take a **required options object with one named field per
tier** (`planPinId`, `columnPinIds`, `localSelectionId`, `globalDefaultId`),
not positional arguments. Never pass an already-resolved id (e.g.
`useEffectiveProfileId`'s `profileId`) into the `globalDefaultId` slot: that
collapses the Plan pin into the lowest tier and lets a column's own pin beat
an active Plan's pin, which is exactly the bug the named-tier shape exists to
prevent. Pass `useEffectiveProfileId`'s `planPinId` as `planPinId` instead.
`budget.computeActiveSummary` / `budget.listProfiles` take the same tiers over
the wire for the same reason. `computeActiveSummary` resolves **per column**,
not once from `selectedColumn` — a profile whose columns pin different
Contribution Profiles is the whole point of per-column pins.

**`null` means two different things and must not be conflated:**

- On a **pin** (`scenarios.*_profile_id`,
  `retirement_salary_overrides.*_profile_id`, any element of
  `budget_profiles.column_*_profile_ids`), `null` means "this Plan/column
  pins nothing — fall through to the next tier". Never rewrite these to a
  concrete id; that silently converts "no pin" into "pinned".
- On the **globally-active setting** (`app_settings.active_contrib_profile_id`
  / `active_salary_profile_id`), `null` means nothing at all. Since
  `0008_kill_live_sentinel` these always name a real row: there is no
  synthetic "Live" profile and no id-`0` sentinel, `useActiveContribProfile` /
  `useActiveSalaryProfile` re-point the setting if the row it names goes
  missing, and the delete guards refuse to remove the active or last
  remaining profile of either kind.

A pin that points at a since-deleted profile silently falls through to the
next tier rather than erroring — `onDelete: "set null"` guarantees the FK
itself can't dangle. Session-only scenarios (never persisted to DB) hold the
same fields as plain React state instead of DB columns; the precedence rule
is identical either way.

Deleting a Contribution/Salary Profile that's pinned by a Plan is **blocked**
by the router (both `delete` procedures name the offending Plan(s)), because
the FK is `set null` and would otherwise silently unpin every Plan
referencing it. Budget Profile deletion instead surfaces the consequence in
the confirmation dialog — see `budget-profile-sidebar.tsx` /
`contribution-profile-manager.tsx`.

---

## Data Model Principles

1. **Person-centric, not employer-centric.** A person has jobs. Jobs change. The person persists.
2. **Generic over specific.** Contribution accounts, savings goals, budget categories — all user-definable.
3. **Snapshots for history, settings for current state.** Time-varying data gets point-in-time records.
4. **Computed values are not stored — with documented exceptions.** Live totals, percentages, and projections are recalculated from source data at read time. **Exceptions** fall into three classes: (a) stored because inputs may not survive, (b) a deliberate point-in-time commitment recorded under whatever was active at save time — the "recorded fact" pattern — which stays fixed even though its inputs DO survive and remain deterministic, because re-deriving it later would mean the value silently changes out from under something that already treated it as settled (a materialized future transaction, a pinned actual), or (c) a pure performance cache of an expensive-but-fully-reproducible computation — inputs survive, recomputation is deterministic, and nothing downstream treats it as settled (unlike (b)), but the computation itself is expensive enough that repeating it on every read is wasteful. Class (c) is only safe when the cache key captures every input that could change the result — an incomplete key silently serves stale-but-presented-as-fresh data, which is exactly the failure mode (a)/(b) don't have to guard against.
   - **`projection_cache`** (`schema-pg.ts`, `src/server/helpers/projection-cache.ts`) — the deterministic Retirement engine result, Monte Carlo, and Coast FIRE MC. Class (c): the cache key is a SHA-256 hash of the canonicalized EXACT object passed to the pure calculator (not the raw tRPC input — the router resolves profile IDs into live DB state that isn't otherwise captured, so hashing only the tRPC input would silently serve stale cross-device results). `engineVersion` is folded into the uniqueness constraint so an engine-logic change invalidates every existing row without a manual cache-clear. TTL 36h; eviction is opportunistic (fire-and-forget on write, not cron-driven) rather than a scheduled job, since writes are infrequent relative to reads. `seed` is stored WITH the row (a miss mints one, a hit replays it) so a cached Monte Carlo result stays honestly reproducible rather than a frozen snapshot of randomness masquerading as determinism.
   - **`net_worth_annual`** — finalized year-end records capture point-in-time state (tax location breakdown from a Dec 31 snapshot that may later be pruned). Class (a).
   - **`annualReturnPct`** — stored on finalized `annual_performance` and `account_performance` rows. Immutable after finalization. Recomputed on-read for non-finalized years. Class (a).
   - **`lifetimeGains`, `lifetimeContributions`, `lifetimeMatch`** — cumulative fields on `annual_performance`. Computed at finalization from previous year's baseline. **Cascade rule:** when `account_performance` rows on a finalized year are edited, lifetime fields on the annual row and all subsequent years must be recomputed. Without cascade, corrections to historical data create silent drift in all forward lifetime totals. Class (a).
   - **`jobs.extra_paycheck_routing.baseNetPayPerCheck`** (plus its `payPeriod`/`anchorPayDate` snapshot) — snapshotted by `computeJobNetPayPerCheck` (savings.ts) only when an extra-paycheck routing rule or its growth rates are saved, resolved against whichever Contribution/Salary Profile was globally active at that moment. Class (b): inputs are preserved and recomputation is deterministic, but this value feeds a materializer that generates real future `savings_planned_transactions` — re-resolving it on every read would mean a routine profile switch silently rewrites a plan the user already committed to. **Cascades on active-profile edits, not on profile switches:** the no-recompute rule protects against _browsing_ a different profile (a what-if comparison must never retroactively rewrite a real plan) — it was never meant to protect against _correcting_ the one real profile that's already active. `salaryProfile.update` refreshes this snapshot automatically (best-effort — a refresh failure never blocks the user's actual edit) whenever the edit targets the globally-active profile and the affected job already has routing configured; editing a non-active profile never triggers it. Recorded at save time (explicit routing save, or an active-profile edit) under whatever was active then, never re-resolved on plain reads. `payPeriod`/`anchorPayDate` are snapshotted alongside `baseNetPayPerCheck` (both optional, materializer/`extraPaycheckRouting.list` fall back to the job's live Salary Profile entry when absent — `jobs` itself has no such columns any more) so the materializer always generates transaction dates against the SAME schedule the net-pay figure was computed under — this is what makes the value internally coherent, replacing the earlier design's save-time mismatch check (removed; a later correction to the job's real pay period/anchor date no longer needs blocking, since it can no longer retroactively desync an already-saved schedule from an already-saved amount — it just doesn't apply until routing is explicitly re-saved, the same way `baseNetPayPerCheck` itself already behaved). **`enabled`** (optional, defaults to true) lets a user pause routing without deleting the configured rules — the Savings/Budget toggle in `extra-paycheck-rules-editor.tsx` (`savings.extraPaycheckRouting.setEnabled`) flips this in place; `enabled: false` (or no `rules` at all) means the extra paycheck stays as regular income, same as an unrouted job. The Budget page's `ExtraPaycheckBudgetNote` shows which months/amounts to expect for jobs in this state, plus the real materialized figure for the current month (see the next entry).
   - **`budget_income_adjustments`** (`schema-pg.ts`) — the Budget-mode counterpart of the `savings_planned_transactions` entry above, written by `budget-income-materializer.ts`. `isExtraPaycheckBudgetMode(routing)` (no `rules`, or `enabled: false`) and the Savings materializer's own filter are mutually exclusive per job — every job matches exactly one of the two at any given time, so the pair of materializers covers every job exactly once under its current mode. One row per (job, month) — no split/goal fan-out, since Budget mode has no split concept. Class (b) for the same reason as `baseNetPayPerCheck`: inputs are preserved and recomputation is deterministic, but re-resolving on every read would silently rewrite an already-materialized month. Same delete-and-reinsert-future-rows regeneration semantics as the Savings materializer, minus the settlement-preservation logic — nothing FK-references these rows, so a plain delete-all-future-`source='rule'`-rows-and-reinsert is safe. `budget.computeActiveSummary`'s `budgetIncomeAdjustmentThisMonth` field sums this table for the REAL current calendar month only, deliberately independent of `selectedColumn`/`profileId` — folding it into `netMonthlyIncome` (which IS `selectedColumn`-parameterized) would let a What-If scenario comparison silently disagree with itself about which reality produced the number. Surfaced as a separate, additively-labeled line in `ExtraPaycheckBudgetNote` and the What-If tab's leftover-income line — never merged into `netMonthlyIncome` or any total derived from it.

   If the inputs are preserved, the computation is deterministic, AND nothing downstream treats the value as a settled point-in-time commitment, compute at read time — unless the computation is expensive enough to justify a class (c) performance cache, in which case store it keyed by a hash of every input that affects the result, with an explicit invalidation path (TTL, version bump, or explicit force-refresh). If the inputs may not survive (snapshots pruned, accounts restructured) — class (a) — or the value is itself a deliberate "recorded as of when this was saved" commitment — class (b) — store at finalization/save time, but document the sync/cascade mechanism (or the explicit absence of one, and why, for class (b)).

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
- **Decimal precision:** `decimal(14,2)` for dollars. Rate columns split
  between `decimal(8,6)` and `decimal(12,6)` depending on the table — both
  safely hold values in `[-1,1]`; there is no single documented convention
  to match, so don't infer one from a neighboring column's comment
- **Enums:** All enum fields use `pgEnum()` for DB-level validation
- **JSONB:** Use `.$type<T>()` for type inference
- **ON DELETE:** Default `RESTRICT`; `CASCADE` only for tightly coupled parent-child
- **Indexes:** Explicit indexes on all FK columns (PostgreSQL doesn't auto-create them)

---

## Settings Belong on Their Pages

> All settings should be controlled on the individual pages that use them, not on a centralized Settings page.

Each page owns its domain data. Users should never have to leave a page to configure its behavior.

| Data                                               | Managed On             |
| -------------------------------------------------- | ---------------------- |
| Contribution accounts, deductions                  | Paycheck page (inline) |
| Current job salary changes                         | Paycheck page (inline) |
| Mortgage loans, extra payments                     | Mortgage page          |
| Cash, house value, home improvements, other assets | Assets page            |
| Savings goals, allocations                         | Savings page           |
| Performance accounts                               | Performance page       |
| Full job/salary history                            | Historical page        |
| ESPP gain calculator, Relocation calculator        | Tools page             |

**Exceptions (centralized Settings page):**

- **People** (name, DOB) — foundational identity used across all pages
- **IRS Limits** — yearly reference data (401k/IRA/HSA caps, FICA rates, standard deductions)
- **Tax Brackets** — yearly, multi-filing-status reference data
- **Return Rates** (age-based expected rate of return) — reference/assumption data feeding projections broadly, not a single page's user-editable setting, despite superficially reading like retirement-adjacent settings
- **Retirement Profile** (retirement ages, timeline, income, decumulation plan, taxes, healthcare, Social Security — `retirement_settings`) — lives on the Budget page's Retirement Profile tab, not the Retirement page. Originally page-local, but the Budget page's other profile levers (Salary, Contributions, Budget, Savings) need visibility into these same assumptions, the same cross-cutting reasoning as Return Rates above — moved here in v0.7.8 rather than duplicated or left orphaned on a page that no longer owns it.

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
- **Colors:** Use centralized helpers from `@/lib/utils/colors.ts` for **every** color that carries meaning — not just account/tax types. This includes chart-series colors, status/severity colors (success/warning/danger/info), and MC-band colors. Two components rendering the same category/status must import the same constant, never re-derive their own hex/Tailwind values inline — this is exactly how the net-worth bar chart and pie chart once showed different colors for the identical category, and how Badge/toast/banner each drifted to a different shade for the same severity.
  - **Account types** (401k, 403b, IRA, HSA, Brokerage): `accountColor()` (bg fill), `accountMatchColor()` (light fill), `accountBorderColor()` (left border), `accountTextColor()` (text)
  - **Tax treatments** (preTax, taxFree, hsa, afterTax): `taxTypeColor()` (bg fill for bars), `taxTypeTextColor()` (text for labels/cells)
  - **Status/severity** (success, warning, danger, info): `STATUS_COLORS` — consumed by `Badge`, `toast`, `ScenarioBanner`, `CalloutLine`. Do not add a new local shade map for the same 4 semantic colors.
  - **Chart series**: named exports from `colors.ts` (`CHART_COLORS`, `EXPENSE_PIE_COLORS`, `mcBandOuter`/`mcBandInner`/`mcMedian`/etc.) — never a local color array or hardcoded hex per chart file.
  - UI badges (BG, PC, etc.) must NOT use account-type colors — use indigo or gray to avoid overlap.
- **Math:** Use `safeDivide()`, `roundToCents()`, `sumBy()` from `@/lib/utils/math.ts`.
- **Shared components:** `EmptyState`, `HelpTip`, `AccountBadge`, `PageHeader`, `LoadingCard`, `ErrorCard`, `ContribPeriodToggle`.
- **Account type config:** `src/lib/config/account-types.ts` is the single source for all account-type behavior. Use `getAccountTypeConfig()`, `getAllCategories()`, `isOverflowTarget()`, `categoriesWithIrsLimit()`, etc. — never hardcode category checks.
- **Display labels:** Import from `src/lib/config/display-labels.ts`. Never define local label maps in components.
- **New shared primitives ship with a real consumer.** A component/hook/util introduced specifically to replace duplicated logic (a new `lib/pure/` function, a `lib/hooks/` hook, a `components/ui/` primitive) must migrate at least one genuine call site in the same PR — never merge one with zero adopters "for later." `FormField`, `useOptimisticMutation`, and `safeDivide()` all shipped unused and the duplication they were meant to kill kept spreading for months until a dedicated audit rediscovered them.

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

## Composed Router Convention

> **Any `src/server/routers/<group>/` directory with more than one file MUST have a `_shared.ts` module.** When two or more procedures in the same group use the same Zod schema fragment, enum, or payload-builder helper, that code goes in `_shared.ts` — not copied across procedure files.

### Rules

1. **`_shared.ts` owns intra-group duplication.** Schemas, enums, and helpers used by ≥2 files in a router group (e.g. `sync/`, `projection/`) are extracted to `<group>/_shared.ts` and imported from there. No `serviceEnum` defined in `config.ts` AND `connections.ts` — one source only.
2. **Procedure types within a group must be consistent unless deliberately scoped.** If 4 of 5 mutations in a group use `adminProcedure` and the fifth uses a different type, document why inline — inconsistency is likely a bug, not a design choice.
3. **`_shared.ts` is internal to the group.** It is never imported by files outside `<group>/`. Cross-group sharing goes through `src/server/helpers/` or a new shared module.

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

## ESPP Accounting

> **ESPP data comes from the ESPP provider's statements. These rules define how those raw figures map to `account_performance` fields.** Any change to ESPP data entry must be consistent with these decisions.

### Accounting decisions

1. **Payroll-year attribution.** Purchase lots belong to the year payroll was withheld, not the settlement year. The Dec 31 lot (shares settle in January) is a **prior-year** contribution. The Mar 31 lot is the current year.

2. **`total_contributions` = market value at purchase.** The provider applies the 15% lookback discount before publishing figures. `total_contributions` is `cost_basis ÷ 0.85` (the market value paid), not the employee's out-of-pocket cost. This is consistent with how 401k/HSA employer match is handled — total always includes both sides.

3. **`employer_contributions` = the 15% discount.** `employer_contributions = total_contributions − cost_basis`. This is the "employer match equivalent" — it is not a cash contribution by the employer, just the discount portion tracked separately for reporting.

4. **`rollovers` on the ESPP (source) account = negative.** Wire transfers from the ESPP provider to the destination brokerage are outgoing rollovers. Record as negative values. Use the YTD total from the provider's statement, not individual transaction amounts.

5. **`rollovers` on the destination brokerage account = positive.** The same dollar amount appears as a positive incoming rollover on the destination brokerage row. `total_contributions` on the destination must be `$0` — the incoming money is a rollover, not a new contribution.

6. **`computeGainLoss` subtracts rollovers in both directions.** `gainLoss = ending − beginning − contributions + distributions − rollovers + fees`. Outgoing rollovers (negative) add back to G/L; incoming rollovers (positive) subtract from G/L. Both are correct — the ending balance at both accounts already reflects the transfer.

7. **Dividends kept in the ESPP account = `distributions`.** Small cash dividends not wired out go in `distributions`, not contributions.

8. **Brokerage commissions = `fees`.** Foreign withholding tax on dividends also goes in `fees`.

### Source documents

Raw provider inputs (withheld, market value, gross proceeds, commission, dividends) are preserved in `.scratch/docs/reviews/ESPP_calculations.md`. Verify DB values against that file before editing ESPP rows.

---

## Permission & Security Gates

> **Every write path goes through the same permission gate.** If the UI shows a button gated by permission X, the tRPC mutation behind it must use the same permission. Mismatches create confusing UX (visible buttons that fail on click) or security gaps (accessible mutations with no UI check).

### Rules

1. **UI permission must match router procedure.** If a component checks `hasPermission(user, "brokerage")`, the mutation it calls must use `brokerageProcedure` (not `adminProcedure` or `protectedProcedure`). Mismatches in either direction are bugs.
2. **Demo mode blocks all write paths.** The `demoOnlyGuard` middleware blocks tRPC mutations. Non-tRPC API routes (`/api/versions/import`, `/api/versions/export`, etc.) must independently check `process.env.DEMO_ONLY` and return 403 — they bypass tRPC middleware.
3. **No unprotected writes.** Every mutation that modifies _shared application data_ must use a domain-specific procedure (`budgetProcedure`, `performanceProcedure`, etc.) or `adminProcedure`. `protectedProcedure` is for reads only.

   **Exception — session/sandbox mutations.** Mutations in `demo.*` may use `protectedProcedure` because (a) they manage HttpOnly cookie state, not application data, or (b) they write to per-user isolated demo schemas, never to shared data, and (c) they must remain callable in DEMO_ONLY mode where the `demoOnlyGuard` middleware exempts demo paths. Demo users are not admins, so `adminProcedure` would break the flow. Each such mutation must carry an inline comment justifying the exception.
