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
6. **parentCategory checks use predicates.** For an account's stored `parentCategory`, use `isRetirementMoney()` (Retirement or no parent — the projection's scope rule), `isRetirementParent()` / `isPortfolioParent()`; for an account type's default, `isRetirementCategory()`. Never `parentCategory === "Retirement"` or `=== "Portfolio"` directly. The predicate functions are the single source of truth for classification.
7. **Tax type checks use predicates.** Use `isTaxFree()` and config helpers — never `taxType === "preTax"` or `=== "roth"` directly. Internal engine keys (`preTax`, `taxFree`, `hsa`, `afterTax`) are canonical but must be accessed through helpers, not inline string comparisons.
8. **Display ordering lives in config.** Category tab order, finalize modal sort order, and any other display ordering of account types or performance categories must be defined once in config and imported — never hardcoded as local arrays in components.
9. **Form defaults come from config.** Initial `useState()` values for account type selectors must use `getAllCategories()[0]` or a config-derived default — never `useState("401k")` or other hardcoded category strings.

### Key Files

| File                                | Role                                                                 |
| ----------------------------------- | -------------------------------------------------------------------- |
| `src/lib/config/account-types.ts`   | `ACCOUNT_TYPE_CONFIG` + every derived helper and predicate           |
| `src/lib/config/account-balance.ts` | Balance-structure helpers (Traditional, Roth, basis)                 |
| `src/lib/config/display-labels.ts`  | Label maps and performance-category constants                        |
| `src/lib/calculators/types.ts`      | `AccountCategory` (derived from config keys), `AccountBalance` union |
| `src/lib/constants.ts`              | App-wide defaults and thresholds                                     |

The rest of `src/lib/config/` holds the other data tables (tax, RMD, IRMAA, ACA, NIIT, Social Security, milestones, recommendations, withdrawal strategies, glossary, …) — one module per subject.

### Fixing a violation: add the predicate first

When you find a category check (`=== '401k'`, `parentCategory === 'Portfolio'`,
`balanceStructure === 'basis_tracking'`, etc.) that should use a config helper,
**the helper may not exist yet**. Don't reach into `ACCOUNT_TYPE_CONFIG[cat].field`
directly from the call site as a workaround — that just moves the violation. The
correct workflow:

1. Add a small predicate to `src/lib/config/account-types.ts` next to the
   existing helpers (`isPortfolioParent`, `isOverflowTarget`, etc.). One
   line of doc-comment naming the config field it reads.
2. Export it.
3. Update every call site to use the new predicate.

This keeps the data-driven boundary intact: call sites stay generic, and the
config file remains the only place that knows what each field means.
Examples: `isInLimit401kGroup` (reads `irsLimitGroup === "401k"`),
`tracksCostBasis` (reads `balanceStructure === "basis_tracking"`).

### Contribution Stubs

When a contribution account is created linked to a performance account, inactive stubs are auto-created for all `supportedTaxTreatments` defined in the config. This ensures the UI always shows the full account structure. Components show inactive stubs as dimmed rows.

---

## Engine Modularity

> **Each engine concern lives in its own module.** The projection engine (`lib/calculators/engine/`) is a set of focused modules plus the `projection-year-handlers/` package (per-year setup, accumulation and decumulation steps). Never add logic inline in the orchestrator — extract it into a module with a clear interface.

The orchestrator (`projection.ts`) calls modules in an explicit pipeline order; each module is a pure function with typed inputs and outputs. **The module map — what each one does and how they depend on each other — lives in `src/lib/calculators/engine/ARCHITECTURE.md`.** Keep it current when adding or removing a module.

### Rules

1. **No new logic in the orchestrator.** `projection.ts` calls modules — it doesn't implement financial logic itself. New features (e.g., a new tax-aware optimization) get their own module.
2. **Explicit pipeline order.** The sequence of operations (contribution routing → growth → withdrawal routing → RMD enforcement → post-withdrawal optimization → balance deduction) is defined in `projection.ts`. Changes to ordering must be intentional and documented.
3. **Module interfaces are contracts.** Each module declares its input type. Callers pass data through the interface — they don't reach into module internals or share mutable state.
4. **Override resolution is centralized.** All per-year sticky-forward config resolution goes through `override-resolution.ts`. No module implements its own override logic.
5. **Balance operations use utilities.** Clone, deduct, grow, and track operations use `balance-utils.ts`, `balance-deduction.ts`, `growth-application.ts`, and `individual-account-tracking.ts`. Never inline balance math in the orchestrator or other modules.

### Public API

`engine/index.ts` is the only entry point: `calculateProjection()`, the tax helpers `estimateEffectiveTaxRate()`, `incomeCapForMarginalRate()`, `marginalRateAboveTarget()`, `computeTaxableSS()`, and `rankWithdrawalTiers()` (withdrawal cost ranking), plus their types. Everything else is internal to `engine/`.

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

| Data                               | Source                                   | Key                                                                                                                                                                                                                                                         |
| ---------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Year-level financial data          | `buildYearEndHistory()`                  | `YearEndRow` from `net_worth_annual` + live current year                                                                                                                                                                                                    |
| Tax location breakdown             | `YearEndRow.portfolioByTaxLocation`      | JSONB on `net_worth_annual` (finalized) / snapshot (current)                                                                                                                                                                                                |
| Budget column                      | `app_settings`                           | `budget_active_column`                                                                                                                                                                                                                                      |
| Annual expenses                    | `getAnnualExpensesFromBudget()`          | Uses `budget_active_column`                                                                                                                                                                                                                                 |
| Total compensation (profile-aware) | `resolveCompensation()`                  | `server/helpers/salary.ts` — the single place salary+bonus is computed under a Salary Profile entry                                                                                                                                                         |
| Salary override merge              | `applyActiveSalary()`                    | Final `active ?? raw` merge of the What-If sandbox salary onto an already-resolved raw salary                                                                                                                                                               |
| Salary override map                | `loadAndApplySalaryProfile()`            | The active (or requested) Salary Profile's entries                                                                                                                                                                                                          |
| Portfolio balances                 | `getLatestSnapshot()`                    | Latest `portfolio_snapshots` row                                                                                                                                                                                                                            |
| Contribution accounts              | `buildContribAccounts()`                 | `contribution_accounts` table                                                                                                                                                                                                                               |
| Employer match                     | `computeGroupedEmployerMatch()`          | Combines Roth/Traditional splits of one account before applying the match cap once; every consumer (`buildContribAccounts`, `buildContributionDisplaySpecs`, `aggregateContributionsByCategory`, `retirement.ts`'s scenario comparison) routes through this |
| Contribution specs                 | `buildContributionDisplaySpecs()`        | Per-account specs, incl. match via `computeGroupedEmployerMatch()`                                                                                                                                                                                          |
| Category aggregations              | `aggregateContributionsByCategory()`     | Contribution + match totals per account category, incl. match via `computeGroupedEmployerMatch()`                                                                                                                                                           |
| Account type config                | `getAccountTypeConfig()`                 | All account-type behavior (from `ACCOUNT_TYPE_CONFIG`)                                                                                                                                                                                                      |
| Parent category map                | `getParentCategory()`                    | Account type → goal category (Retirement/Portfolio) via config                                                                                                                                                                                              |
| Mortgage balance                   | `computeMortgageBalance()`               | Amortization from loans + extra payments                                                                                                                                                                                                                    |
| Financial rules & milestones       | `evaluateMilestones()`                   | `lib/pure/milestones.ts` — Checkup, Milestones page and Retirement readiness all read its results; thresholds in `lib/config/milestones.ts`                                                                                                                 |
| Household annual income            | `computeAnnualEarnings()`                | `lib/pure/household-income.ts` — salary + the resolved bonus, pre-tax money (incl. bonus-check contributions), FICA wages; the annual tax, Income card, Living Costs and MAGI all read it (never re-sum `salary`)                                           |
| Household tax                      | `calculateHouseholdTax()`                | `lib/calculators/tax.ts` — federal on combined income, SS per person, Additional Medicare on the household above the liability row                                                                                                                          |
| Roth IRA eligibility               | `buildRothIraView()`                     | `lib/pure/roth-ira.ts` — the Income card panel and the Roth / pro-rata recommendations read it                                                                                                                                                              |
| Holding periods                    | `deriveObservedPeriods()` / `periodOn()` | `lib/pure/holding-periods.ts` — observed periods derived from `holding_observations` on read; entered ones in `holding_periods`; per part (`accountSplits` / `partSharesOn`) only for an account whose feeds are linked per part                            |

### Rules

1. **No hardcoded fallbacks for user-specific data.** If data doesn't exist, return 0 — don't invent a number. Universal defaults (4% withdrawal rate, IRS limits) are acceptable if stored in DB.
2. **One budget column controls everything.** `budget_active_column` determines which spending level (column) is shown across all pages.
3. **What-ifs are explicit opt-ins.** Sandbox controls (the What-If tab) are clearly labeled as "what-if", never write the active profiles, and never leak into other pages.
4. **Shared helpers, not duplicated queries.** Use `helpers.ts` when multiple routers need the same derived value.
5. **Age and personal data come from the `people` table.** Never hardcode ages or personal details.
6. **Grep before reimplementing a documented rule.** Before writing a display rule, derived formula, or label mapping that plausibly already exists (check DESIGN.md and grep for similarly-named components/hooks first), find and reuse the existing implementation rather than writing a second one from the spec. Two independent implementations of the same rule will diverge — this is how the sub-row label rule, tax-type labels, and the household savings-rate formula each shipped real bugs after being written twice.

### The Salary Profile layer

`jobs` carries no compensation, schedule, W-4, or extra-paycheck-routing
data of its own any more — it is pure identity/lifecycle (`id`, `personId`,
`startDate`, `endDate`, `isSpeculative`, `employerName`, `title`). Every
number and election a job needs for a live calculation comes from a
**Salary Profile**: `salary_profiles.salaries` maps `jobId` (string key) to
a **complete entry**:

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
  extraPaycheckRouting: ExtraPaycheckRoutingData | null; // null = none configured
  bonusDestination?: BonusDestination; // "budget" | "spending"; absent = the budget
  otherEarnings?: Record<string, number>; // other pay per check; absent = none
};
```

> **A job either has every required field in a given profile, or none at all.**

There is no partial-pin state, no per-field presence check, and no "resolves
live from the job record" fallback — a job has nothing left on `jobs` to
fall back to. A profile that doesn't mention a job says **nothing** about
it: salary/bonus resolve to $0/no bonus, and every other field resolves to
`undefined`, which every consumer must treat as a real "incomplete" signal
(see `mergeSalaryProfileJobFields`/`resolveContribPeriods`'s pattern of
excluding rather than guessing) — never a substitute for a live column,
because none exists. `salaryEntrySchema` (`json-schemas.ts`) is `.strict()`
so a partial or stale-shaped entry is rejected at write time, not silently
stored and later misread. It also carries every limit: amounts are ≥ 0,
`monthsInBonusYear` 0–12, `anchorPayDate` a real date (1900–2100),
`bonusMonth` 1–12, `bonusDayOfMonth` 1–31, `budgetPeriodsPerMonth` > 0
(null = the schedule's usual number).

**One parse for every salary editor.** A field edit from the Paycheck page
or Profiles → Salary goes through `salaryEntryEdit()`
(`lib/db/salary-entry-edit.ts`), which checks the value against
`salaryEntrySchema`'s own field, and is saved with `salaryProfile.patchEntry`
(a field-level merge in one transaction — never a whole-`salaries` PUT from
a client copy). Never add a second parse or a second set of limits.

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
the other (non-comp) fields onto a job object — every router that needs
`payPeriod`/`w4FilingStatus`/etc. on a job calls this rather than
re-deriving the merge.

**A Contribution Profile never touches jobs:** its buckets are
`contributionAccounts` and `deductions` only (the `jobs` bucket that used to
override `employerName`/bonus-pay-date/bonus-inclusion-flags is deleted
wholesale). How much the bonus is is a Salary Profile fact. Whether a
contribution is also taken from bonus checks is a per-account contribution
election (`contributionAccounts[id].fromBonus`, absent = no), read only
through `takesFromBonusCheck()` / `rowTakesFromBonusCheck()`
(`lib/calculators/paycheck.ts`: paid through payroll — `isPaidThroughPayroll()`,
the one definition — and `fromBonus`). `bonusCheckContribution` (what the
bonus check takes) and the employer match's pay both use it: an account's
match is figured on base salary, plus the bonus only when its own match
group (job/person + account type + parent category — a Roth/Traditional
pair is one account) is taken from bonus checks
(`matchPayGroupsWithBonus`, `server/helpers/contribution.ts`). One account's
election never moves another account's match. Two consequences of the
deleted bucket, both intentional:

1. **`employerName`'s profile-override capability is gone**, not preserved
   elsewhere. Modeling "a different employer, same everything else" via a
   named override is no longer supported — modeling a genuinely different
   job means creating a new `jobs` row, which already carries its own
   `employerName`. A real feature reduction, not a bug.
2. **The permission gate for W-4/schedule/bonus-date fields moved.** These
   used to be admin-only (raw `jobs.update`, `adminProcedure`). They're now
   part of a Salary Profile entry, written through
   `salaryProfile.create`/`update`/`duplicate`/`patchEntry`/`removeEntry`
   (all `contributionProfileProcedure`; the editors use `patchEntry`) — no
   longer admin-gated. Anyone who could already edit a Contribution Profile
   can now set these for any job — including where the bonus goes
   (`bonusDestination`, absent = the budget), which used to be an admin-only
   household setting. The UI gates on the same permission
   (`hasPermission(user, "contributionProfile")`, via
   `resolvePaycheckEditTarget`).

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
  `contributionAccounts`/`deductions` remain; any per-job bucket; any second
  bonus-contribution gate besides `takesFromBonusCheck`; an inline
  `isPayrollDeducted ?? jobId !== null` instead of `isPaidThroughPayroll()`
- A salary figure displayed as a Contribution Profile statistic
- A job's `payPeriod`/`w4FilingStatus`/etc. treated as `undefined` meaning
  the same thing as `0`/`false`/a guessed default, instead of "incomplete —
  exclude, don't guess"
- A fallback value that silently replaces missing data
- Two routers fetching the same data independently
- A What-If sandbox value that leaks into another page or into the active profiles
- Logic, wording or UI that treats one profile as a baseline ("Main", "default", "not active — viewing", "changed from main")
- User-facing text that says "pin/pinned" (say active or set), "override" (say set, changed, changes by year, month changes), "customized"/"customize" (say set or changed), or "Monte Carlo"/"MC" (say Simulation). Code names may keep them.
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
- `parentCategory === "Retirement"` / `=== "Portfolio"` instead of `isRetirementMoney()` / `isRetirementParent()` / `isPortfolioParent()`
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

## Profiles and Plans

**Each profile is its own world.** Salary, Contribution, Budget and
Retirement profiles are independent of each other and of every other profile
of the same kind. There is no default, "Main" or "Live" profile and no
baseline to diff against — only the **active** profile of each kind
(`app_settings.active_salary_profile_id` / `active_contrib_profile_id` /
`active_retirement_profile_id`, `budget_profiles.is_active`). Every page shows
the active profiles, and an edit to a profile field saves to the profile it
belongs to.

**A Plan is a named set of profiles** — one of each kind, nothing else
(`scenarios`: `name`, `description`, four profile FKs, `ON DELETE set null`).
It holds no values of its own. **Applying** a Plan (`settings.scenarios.activate`
→ `applyPlan`) writes its profiles as the active ones, in one transaction,
after checking the permission each kind's own "make active" needs (budget →
`budget`, contribution/salary → `contributionProfile`, retirement → admin) —
a refusal never half-applies. Applying is household-wide: sync, snapshots and
every page then use that set.

- **Which Plan is in use is derived, never stored**: the Plan whose profiles
  equal the active ones (`planMatchesActive`). Change any one active profile
  and the header shows "None (unsaved mix)" — trying a mix is a normal,
  unsaved state. `app_settings.last_applied_plan_id` is kept only so the header
  can offer "Update ‹Plan›" or "Save as new Plan".
- **Every saved grouping of profiles is a Plan.** No other feature stores its
  own combination of profiles for comparison — Budget columns are spending
  levels with no profiles of their own (see "Profile Resolution").
- A new Plan names all four kinds (create/update require them). A null slot —
  only on Plans saved before this rule — leaves that kind's active profile
  alone when applied.
- Plan names are unique (`CONFLICT` on create/rename).
- Deleting a profile any Plan uses is **refused** for all four kinds
  (`assertNoPlanUses`, message from `planInUseMessage`), because the FK is
  `set null` and would otherwise silently empty that slot of the Plan.
- A Plan holds no values: migration 0009 turned the salaries older Plans
  stored (`scenarios.overrides`) into Salary Profiles and dropped
  `overrides`/`is_baseline`. Never add a value to a Plan — make a profile.

**What-If** (Budget page tab) is the only unsaved sandbox: its pickers and
edits are local state and never write the active profiles. To keep a What-If
result, save its edits as profiles (and those profiles as a Plan).

**View Mode** = global toggle: "Projected", "Year-end estimate", "Year to date".
A card that can't honor it says so instead of silently showing another mode.

### Lever Order

The three profile-driven "levers" have a real dependency chain, and pages/UI
ordering should follow it: **Contributions → Budget → Savings**. Contribution
elections (+ salary) determine take-home pay; the Budget consumes that
take-home pay and leaves a monthly surplus/deficit; Savings allocations spend
whatever the Budget leaves over. Changing an earlier lever changes every
later one's numbers — the reverse is never true. This is why the Profiles
page's tabs run Salary, Contributions, Savings (the Budget has its own page
between them in the chain), then Retirement and What-If, which consume the
rest — not alphabetically or by table-creation order.

### Profile Resolution

Which profile a page shows (see `useEffectiveProfileId`): **the page's own
local selection → the active profile.** Local selections exist only where a
page edits or previews a profile without making it active: a profile
manager's "which one am I editing" row and the What-If sandbox. A Plan is not
a tier — applying it changes the active profiles.

Budget columns have **no profiles of their own**: every column uses the
same (Contribution, Salary) pair — the page's local selection → the active
one. `budget.computeActiveSummary` takes two-tier
`{ localSelectionId, globalDefaultId }` objects (`profileResolutionTiersSchema`
/ `profileFromTiers`) with no column tier; callers with no page context use
`resolveActiveProfilePair`. A linked item's dollars are computed once
(`resolveLinkedBudgetItemAmounts(db, items, n, pair)`) and repeated across
columns. Migration 0009 dropped the old per-column profile ids. Never add a
per-column profile back — a different set of profiles is a different Plan.

**`null` means two different things and must not be conflated:**

- In a **Plan slot**, `null` means "names no profile —
  fall through". Never rewrite these to a concrete id.
- On the **active setting**, `null` means nothing at all. Since
  `0008_kill_live_sentinel` these always name a real row:
  `useActiveContribProfile` / `useActiveSalaryProfile` re-point the setting if
  the row it names goes missing, and the delete guards refuse to remove the
  active or last remaining profile of either kind.

A local selection pointing at a since-deleted profile falls through to the
active one rather than erroring.

---

## Data Model Principles

1. **Person-centric, not employer-centric.** A person has jobs. Jobs change. The person persists.
2. **Generic over specific.** Contribution accounts, savings goals, budget categories — all user-definable.
3. **Snapshots for history, settings for current state.** Time-varying data gets point-in-time records.
4. **Computed values are not stored — with documented exceptions.** Live totals, percentages, and projections are recalculated from source data at read time. **Exceptions** fall into three classes: (a) stored because inputs may not survive, (b) a deliberate point-in-time commitment recorded under whatever was active at save time — the "recorded fact" pattern — which stays fixed even though its inputs DO survive and remain deterministic, because re-deriving it later would mean the value silently changes out from under something that already treated it as settled (a materialized future transaction, a pinned actual), or (c) a pure performance cache of an expensive-but-fully-reproducible computation — inputs survive, recomputation is deterministic, and nothing downstream treats it as settled (unlike (b)), but the computation itself is expensive enough that repeating it on every read is wasteful. Class (c) is only safe when the cache key captures every input that could change the result — an incomplete key silently serves stale-but-presented-as-fresh data, which is exactly the failure mode (a)/(b) don't have to guard against.
   - **`projection_cache`** (`schema-pg.ts`, `src/server/helpers/projection-cache.ts`) — the deterministic Retirement engine result, Monte Carlo, and Coast FIRE MC. Class (c): the cache key is a SHA-256 hash of the canonicalized EXACT object passed to the pure calculator (not the raw tRPC input — the router resolves profile IDs into live DB state that isn't otherwise captured, so hashing only the tRPC input would silently serve stale cross-device results). `engineVersion` is folded into the uniqueness constraint so an engine-logic change invalidates every existing row without a manual cache-clear. TTL 36h; eviction is opportunistic (fire-and-forget on write, not cron-driven) rather than a scheduled job, since writes are infrequent relative to reads. `seed` is stored WITH the row (a miss mints one, a hit replays it) so a cached Monte Carlo result stays honestly reproducible rather than a frozen snapshot of randomness masquerading as determinism.
   - **`utility_reading.cost` filled from the budget** (`source` `ynab`/`actual`, the utilities cost feed) — a month's net spend in the mapped budget category, stored because the budget's synced transactions only reach back about a year and a half; older months can't be recomputed, and the household can override any month (a typed cost is never replaced). Refreshed only by an explicit pull the household reviews. Class (a).
   - **`net_worth_annual`** — finalized year-end records capture point-in-time state (tax location breakdown from a Dec 31 snapshot that may later be pruned). Class (a).
   - **`annualReturnPct`** — stored on finalized `annual_performance` rows; recomputed on read for non-finalized years. Per-account returns are always computed on read from the row's own figures (`account_performance.annual_return_pct` is not read). A finalized year's stored return may not be reproducible from its rows (an override, imported history), so an edit to that year's account rows keeps its basis rather than recomputing it (`rebaseLockedReturn`). Class (a).
   - **`lifetimeGains`, `lifetimeContributions`, `lifetimeMatch`** — cumulative fields on `annual_performance`. Computed at finalization from previous year's baseline. **Cascade rule:** when `account_performance` rows on a finalized year are edited, that year's category and Portfolio rows and the lifetime fields of every later year move by exactly what the edit changed — never re-summed from the first stored year, because a baseline can predate the tracked rows (history carried in at setup, an account that changed category). One path does this for every edit (`syncYearRollups` in `src/server/helpers/performance-rollups.ts`); without it, corrections to historical data silently drift every forward lifetime total. Class (a).
   - **Performance account edits** — one write path, `editAccountRow` (`src/server/helpers/performance-edit.ts`): a row that balanced before stays balanced (when the edit doesn't set the gain, the gain follows), a row with a deliberate gap keeps its gain; `chainNextYear` moves next year's beginning with a changed ending, and that row's gain follows only if it balanced. A preview (`dryRun`) runs this same path inside a transaction and rolls it back — never a second, "what would change" computation.
   - **Reconciliation checks and accepted gaps** — computed on read (`lib/pure/performance-checks.ts`, loaded once in `server/helpers/performance-checks.ts`), never stored. A household's acceptance (`account_performance.accepted_checks`) stores the gap it accepted, with its own reason; the check comes back as soon as the gap differs. Estimated marks (`estimated_fields`) are cleared only by the household confirming a figure (or a snapshot setting the ending from a real balance) — finalizing never clears them.
   - **A Salary Profile entry's `extraPaycheckRouting.baseNetPayPerCheck`** (with the `payPeriod`/`anchorPayDate` it was computed under) — snapshotted by `computeJobNetPayPerCheck` when an extra-paycheck routing rule is saved, under the profiles active at that moment. Class (b): it feeds a materializer that writes real future `savings_planned_transactions`, so browsing another profile must never rewrite it. Editing the **active** profile does refresh it (`refreshExtraPaycheckRoutingIfActive`, best-effort — never blocks the edit); editing any other profile doesn't. Storing the schedule with the amount keeps the generated dates and the net-pay figure from the same moment. `enabled: false` (or no `rules`) pauses routing: the extra paycheck stays regular income.
   - **`budget_income_adjustments`** — the Budget-mode twin of the entry above, written by `budget-income-materializer.ts`. A job is in exactly one mode (`isExtraPaycheckBudgetMode`), so the two materializers cover every job once. One row per (job, month); regenerated by deleting and reinserting future rule rows (nothing references them). Class (b) for the same reason. `budget.computeActiveSummary` reports the real current month's total separately (`budgetIncomeAdjustmentThisMonth`) and never folds it into `netMonthlyIncome` — that figure follows the selected column, so mixing them would let a What-If disagree with itself.

   If the inputs are preserved, the computation is deterministic, AND nothing downstream treats the value as a settled point-in-time commitment, compute at read time — unless the computation is expensive enough to justify a class (c) performance cache, in which case store it keyed by a hash of every input that affects the result, with an explicit invalidation path (TTL, version bump, or explicit force-refresh). If the inputs may not survive (snapshots pruned, accounts restructured) — class (a) — or the value is itself a deliberate "recorded as of when this was saved" commitment — class (b) — store at finalization/save time, but document the sync/cascade mechanism (or the explicit absence of one, and why, for class (b)).

5. **Limits and rules are data, not code.** IRS limits, tax brackets, return rates — all in the DB, versioned by year.
6. **DB is the single source of truth.** No hardcoded fallback values for user-specific data. Universal mathematical defaults (`DEFAULT_WITHDRAWAL_RATE = 0.04`, `DEFAULT_TAX_RATE_*` in `constants.ts`) are acceptable as they represent well-established financial planning conventions, not user data.
7. **Standardized naming.** Tax buckets use canonical keys everywhere: `preTax`, `taxFree`, `hsa`, `afterTax`. Display labels are applied at the UI layer via lookup maps. `parentCategory` (not `goalCategory`) is the unified field name across all tables.
8. **No hardcoded user data.** Never reference specific names, employers, job titles, or other user-specific data in code. Everything comes from the DB. The app must work for any household, not just the current users.
9. **Account type validation is app-level, not DB-level.** `accountType` columns are `text` (not enum), validated at the app layer against `ACCOUNT_TYPE_CONFIG` keys via `accountCategoryEnum()`. This allows adding new account types without DB migrations.
10. **Programmatic account naming.** `accountLabel` is server-computed via `buildAccountLabel()` from `format.ts`: `{Owner} {Label?} {SubType || Type} ({Institution})`. `displayName` is an optional user override. All display uses `accountDisplayName()` — never inline `displayName ?? accountLabel` or direct field reads. Owner is baked into the label; components must NOT append owner separately.

### Data-converting migrations

A migration that rewrites data runs **one converter** both on a live
database (`db-migrate.ts`, inside the migration's transaction, just before
its SQL drops what the converter reads) and on an older backup being
restored (`backup-transforms.ts` → `transformBackupToCurrentSchema`, e.g.
`transformV0810ProfileSets`). `db-migrate.ts` is compiled on its own and
can't import from `src/`, so it keeps an **identical copy** of the converter
between `// BEGIN …` / `// END …` markers — a test checks the copies match
(`tests/db/v0810-profile-sets.test.ts`); edit both together. Converters work
on snake_case rows (JSON as object or text), are idempotent (a no-op once
their source is gone) and write only non-default values; the restore path
also drops the columns the migration drops, and each new data-changing
migration tag goes in `V08_SCHEMA_TAGS`. A replayed unique violation is
swallowed on PostgreSQL, so a migration that adds a unique index asserts it
exists afterwards (`assertV0810IndexPg`).

### Account Categories

Two `parentCategory` values classify all investment accounts by their goal:

| Category       | Account Types        | Used For                                                    |
| -------------- | -------------------- | ----------------------------------------------------------- |
| **Retirement** | 401k, 403b, IRA, HSA | Retirement projections, contribution engine                 |
| **Portfolio**  | Brokerage            | Portfolio totals only; excluded from retirement projections |

Each account type has a default `parentCategory` in `ACCOUNT_TYPE_CONFIG` (brokerage defaults to Portfolio, retirement accounts default to Retirement). The `parentCategory` is user-editable per account in the Portfolio page and controls all routing — retirement projections include only Retirement-category accounts, the brokerage page shows only Portfolio-category accounts. The config default determines the initial assignment, but `parentCategory` is the single source of truth for behavior.

**Note:** ESPP, Rollover, Employer Match, Profit Sharing are **sub-types** (`subType` field) of their parent account type — not separate account categories. The 5 account categories are: `401k`, `403b`, `ira`, `hsa`, `brokerage`. Sub-types are defined per account type in `ACCOUNT_TYPE_CONFIG.subTypeOptions`.

**Retirement ⊂ Portfolio.** Portfolio means ALL accounts. Retirement is the subset used for retirement projections. Every account either rolls up directly to Portfolio or into Retirement (which is included in Portfolio).

**What Portfolio money may and may not affect (the retirement-scope contract, v0.8.11).** Portfolio-parented accounts (savings outside the retirement plan) are never spent in retirement. In the projection engine and everything built on it:

- **Retirement answers read retirement money only** — `retirementBalance` on each year row (every account minus the Portfolio-parented ones, `scopedBalances`): spending strategies and the rate-seeded first year, depletion (`retirementDepletionAge`), the plan verdict (`assessPlan`, `lib/calculators/plan-outcome.ts` — the one judge for success/failure everywhere), simulation success, bands and terminal balances, Coast FIRE, strategy comparison, the Social Security / bracket optimizers, tax optimization, relocation, stress tests, nest-egg figures, and Simple tax mode (which simulates retirement money alone).
- **Retirement money never becomes Portfolio money**: contribution overflow, reinvested RMD money and retirement lump sums go to Retirement brokerages (a projection-only one when there are none); the contribution-rate ceiling caps retirement contributions only.
- **Portfolio money is never spent for retirement or moved into it**: brokerage goals, the Brokerage page's ramp and lump sums are Portfolio money; balance corrections take from retirement accounts first.
- **`allAccountsBalance` (Portfolio included) is for net-worth views only** — FI milestones (liquid net worth = every account plus cash) and the Money Guy benchmark. The `local/no-all-accounts-balance` lint rule enforces the allow-list; `tests/calculators/retirement-scope-invariance.test.ts` proves +$1M of Portfolio money changes no retirement answer.
- **The one coupling: RMDs.** Required minimum distributions on Portfolio-parented Traditional accounts are real (the IRS doesn't care how accounts are categorized), so they still raise taxable income and RMD amounts.

**Simulated vs baseline (one display rule, v0.8.11).** A nest egg (or end balance) is shown through `simulatedOrBaseline` (`lib/pure/nest-egg-display.ts`) everywhere it appears — the dashboard's Retirement card and the Retirement page's hero:

- With a simulation for the current inputs: the simulated median at the target age (retirement age, or today when already retired), "Range p25 – p75", and "Baseline: $X (fixed returns)". Today's dollars for a simulated figure = the nominal band value deflated by the plan's inflation rate to the band's year, the same conversion the baseline uses.
- Without one: the baseline, labelled "baseline (fixed returns)", with a pointer to the Retirement page to run the simulation. The dashboard never runs a simulation; it reads the page's cached run.
- A person filter always shows the baseline — the simulation is the whole household's.
- Every surface builds its projection input with `usePlanEngineInput` (and the default simulation is `DEFAULT_SIMULATION`), so the dashboard reads exactly the run the Retirement page made. Cached runs key on the full built input with dates truncated to the calendar day, and expire after 36 h.

**Single source of truth:** `getParentCategory()` from `src/lib/config/account-types.ts`. It reads the `parentCategory` config property for each account type. Contribution and retirement routers use this for page-level filtering (which page owns the account).

#### Performance page display categories

The Performance page uses a **separate grouping** based on `accountType` from the `performance_accounts` master table — not `parentCategory`. This groups accounts by what they _are_, not their goal:

| Display Category | Account Types                                        | Derived From                |
| ---------------- | ---------------------------------------------------- | --------------------------- |
| **Brokerage**    | All brokerage accounts (Long Term, Retirement, ESPP) | `accountType = 'brokerage'` |
| **HSA**          | All HSA accounts                                     | `accountType = 'hsa'`       |
| **Retirement**   | 401k, 403b, IRA                                      | Everything else             |
| **Portfolio**    | All accounts combined                                | Sum of all categories       |

This mapping is `accountTypeToPerformanceCategory()` (`lib/config/display-labels.ts`). Annual rollup rows (`annual_performance.category`) and account filtering both use this grouping. For `account_performance` rows without a `performanceAccountId`, the system falls back to matching by `institution + accountLabel` against the master table, then to the stored `parentCategory`.

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
- **Enums:** enum-like columns are `text` typed with `.$type<T>()` and validated by Zod at the app layer — no `pgEnum`, so adding a value needs no migration
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

## Links into Pages

> A link lands on the data it's about, not the top of a page.

- **Senders carry a `Focus`, never a route string.** Recommendations, milestones, data sources, Financial Checkup and dashboard card sections build links with `focusHref` / `<FocusLink>` (`lib/config/focus-topics.ts`). A card header's plain `href="/page"` is the card's general link and stays.
- **One home per topic.** `FOCUS_HOMES` maps each topic (named for the data, never a page) to its route, the page state it needs (`FOCUS_STATE` — typed, so a wrong value doesn't compile) and whether a section is marked. Context belongs to the sender: it picks the topic (a covered bridge → `earlyAccess`; a short year → `projectionYear`), the table never branches. A home is never a redirect page (the redirect drops the query).
- **Pages opt in, they aren't redesigned.** `useFocusedState` for a tab/view, `useFocusReveal` for a collapsed section, `useFocusMatch` for anything else that must reveal itself (a filtered table row), `FocusTarget` / `useScrollToFocus` to scroll to and ring the section. A tab's side effects follow from its value, not its click handler.
- **A focus only opens a view.** It's read from the URL every render (never seeded once), copied into local state when it arrives, and cleared when the user makes a choice. It never writes saved settings, never opens an edit form or unlocks an edit lock, and never changes the active profile, What-If or the Projected/YTD view. A stale id (a deleted goal) lands on the page without an error.
- **Cards:** a linked `Card`'s title is its link; a click elsewhere on the card follows it unless it lands on a control, in a portal, or ends a text selection. Never wrap a card in `<a>` — links inside it would nest.
- Enforced by `tests/lint/focus-links.test.ts` (no route literals in senders; every topic's home renders its target and reads its state; no redirect homes).

---

## Coding Conventions

- **Pure calculators.** `lib/calculators/` contains pure functions only — no DB, no tRPC, no React. Given the same inputs, always the same outputs. The engine is a modular subdirectory (`lib/calculators/engine/`) — see § "Engine Modularity".
- **tRPC routers are the bridge.** They fetch from Drizzle, convert decimal strings to numbers via `toNumber()`, call calculators, return results.
- **tRPC verb prefixes:** `get*` — single stored item or current state; `list*` — collection/array result; `compute*` — derived calculation or aggregation. Never use `get*` for procedures that aggregate or compute.
- **Variable naming — no abbreviations.** Use full names: `percent` not `pct`, `amount` not `amt`, `account` not `acct`, `year` not `yr`, `index` not `idx`, `month` not `mo`. Existing abbreviations are migrated incrementally when files are touched for other reasons.
- **Type suffix conventions:** `*Props` for React component props; `*Input` / `*Result` for procedure/calculator I/O types; `*Config` / `*Options` for settings and configuration objects; domain nouns (no suffix) for data shapes (e.g. `DeductionLine`, `BudgetMatch`).
- **Components never import from `server/`.** They consume data via tRPC hooks.
- **Two state layers:** server state (React Query via tRPC) and local component state (`useState`, which also holds form state — no form library).
- **Formatting — zero exceptions.** Use `formatCurrency()`, `formatPercent()`, `compactCurrency()`, `formatDate()` from `@/lib/utils/format`. **Never** inline formatting — this includes chart axis tick formatters, tooltip renderers, and input display formatters. If the canonical function doesn't support your precision needs, extend the function (e.g., `formatPercent(value, decimals)` already accepts a decimals argument) — don't bypass it. Inline `.toFixed(N) + '%'` and `'$${n/1000}k'` are violations. Every dollar amount must go through `formatCurrency()` / `compactCurrency()` — or `maskAmountsInText()` for a sentence the engine or a router already built — so Privacy Mode can hide it (see DESIGN.md § Privacy Mode). A hand-rolled `Intl.NumberFormat` or `$${n.toLocaleString()}` in a component shows the real amount while privacy is on.
- **Colors:** Use centralized helpers from `@/lib/utils/colors.ts` for **every** color that carries meaning — not just account/tax types. This includes chart-series colors, status/severity colors (success/warning/danger/info), and MC-band colors. Two components rendering the same category/status must import the same constant, never re-derive their own hex/Tailwind values inline — this is exactly how the net-worth bar chart and pie chart once showed different colors for the identical category, and how Badge/toast/banner each drifted to a different shade for the same severity.
  - **Account types** (401k, 403b, IRA, HSA, Brokerage): `accountColor()` (bg fill), `accountMatchColor()` (light fill), `accountBorderColor()` (left border), `accountTextColor()` (text)
  - **Tax treatments** (preTax, taxFree, hsa, afterTax): `taxTypeColor()` (bg fill for bars), `taxTypeTextColor()` (text for labels/cells)
  - **Status/severity** (success, warning, danger, info): `STATUS_COLORS` — consumed by `Badge`, `toast`, `CalloutLine` and status rows. Do not add a new local shade map for the same 4 semantic colors.
  - **Chart series**: named exports from `colors.ts` (`CHART_COLORS`, `EXPENSE_PIE_COLORS`, `mcBandOuter`/`mcBandInner`/`mcMedian`/etc.) — never a local color array or hardcoded hex per chart file.
  - UI badges (BG, PC, etc.) must NOT use account-type colors — use indigo or gray to avoid overlap.
- **Math:** Use `safeDivide()`, `roundToCents()`, `sumBy()` from `@/lib/utils/math.ts`.
- **Shared components:** `EmptyState`, `HelpTip`, `AccountBadge`, `PageHeader`, `LoadingCard`, `ErrorCard`, `ContribPeriodToggle`.
- **Account type config:** `src/lib/config/account-types.ts` is the single source for all account-type behavior. Use `getAccountTypeConfig()`, `getAllCategories()`, `isOverflowTarget()`, `categoriesWithIrsLimit()`, etc. — never hardcode category checks.
- **Display labels:** Import from `src/lib/config/display-labels.ts`. Never define local label maps in components.
- **Comments explain the code, not its history.** A comment should make sense to a developer reading the code cold, with no access to the review session, PR, or roadmap item that produced it. Keep the technical _why_ (a race condition, a real constraint, a non-obvious edge case, a user-reported bug and what actually happened); drop the _citation_ — finding IDs (`H10`, `M42`, `C2`), severity/priority tags (`Critical`, `P0`, `Blocker`), roadmap item numbers (`R32`, `R43`), PR/batch/phase references ("Extracted in PR 8/3a of the v0.5.2 refactor"), bare date-stamps ("found 2026-08-31:", "Decision confirmed 2026-08-19."), and references to plan/review/scratch docs (`PLAN-*.md`, `REVIEW-*.md`, `.scratch/docs/**`) — those docs get renamed and deleted, and the citation rots into a dangling pointer while the comment itself never gets fixed. That context belongs in the commit message, which doesn't rot. A comment that is pure citation with nothing left once the citation is stripped gets deleted outright, not left as an orphaned tag.
  - **Exceptions — these are not provenance, keep them:** references to `docs/RULES.md` / `docs/DESIGN.md` / `docs/TESTING.md` / `docs/OPS.md` (permanent, load-bearing); statutory/tax dates and law versions (`SECURE 2.0 (2023)`, `OBBBA (2025)`, IRS Notice/Rev. Proc. numbers, `tax_year` values); the `PROJECTION_CACHE_ENGINE_VERSION` per-bump changelog in `projection-cache.ts` (a live, code-dependent version history); `@deprecated` tags describing what to do about the deprecated thing (drop the bare `R##`/finding-ID if one rides along, keep the reasoning); a `v0.8.0 squash` (or similar) constraint that tells a reader "don't remove this dead-but-present column/key yet" — reword to drop the version number if it's not otherwise meaningful, but keep the constraint.
  - **Do keep incident narratives where the story is the documentation** — "found live 2026-08-31: a household that had linked both YNAB and Actual saw their YNAB links vanish while fixing stale Actual links" is not a citation, it's the only record of a real, non-obvious edge case. The test is whether the sentence still means something to a cold reader with the date/tag deleted — if yes, and the remaining prose still explains a genuinely surprising behavior, keep it; if the date/tag was the whole point, cut it.
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

7. **Dividends that stay in the account are not `distributions`.** They are already in the ending balance — or in a later transfer out, counted in `rollovers` — so recording them as `distributions` too counts them twice in the gain. `distributions` is only money paid out to the owner that isn't a transfer to another tracked account (e.g. a dividend paid straight to a bank account).

8. **Brokerage commissions = `fees`.** Foreign withholding tax on dividends also goes in `fees`.

### Source documents

Raw provider inputs (withheld, market value, gross proceeds, commission, dividends) are kept in a local audit file (`.scratch/docs/ops/ESPP_calculations.md`, not in the repo). Verify DB values against it before editing ESPP rows.

---

## Permission & Security Gates

> **Every write path goes through the same permission gate.** If the UI shows a button gated by permission X, the tRPC mutation behind it must use the same permission. Mismatches create confusing UX (visible buttons that fail on click) or security gaps (accessible mutations with no UI check).

### Rules

1. **UI permission must match router procedure.** If a component checks `hasPermission(user, "brokerage")`, the mutation it calls must use `brokerageProcedure` (not `adminProcedure` or `protectedProcedure`). Mismatches in either direction are bugs.
2. **Demo mode blocks all write paths.** The `demoOnlyGuard` middleware blocks tRPC mutations. Non-tRPC API routes (`/api/versions/import`, `/api/versions/export`, etc.) must independently check `process.env.DEMO_ONLY` and return 403 — they bypass tRPC middleware.
3. **No unprotected writes.** Every mutation that modifies _shared application data_ must use a domain-specific procedure (`budgetProcedure`, `performanceProcedure`, etc.) or `adminProcedure`. `protectedProcedure` is for reads only.

   **Exception — session/sandbox mutations.** Mutations in `demo.*` may use `protectedProcedure` because (a) they manage HttpOnly cookie state, not application data, or (b) they write to per-user isolated demo schemas, never to shared data, and (c) they must remain callable in DEMO_ONLY mode where the `demoOnlyGuard` middleware exempts demo paths. Demo users are not admins, so `adminProcedure` would break the flow. Each such mutation must carry an inline comment justifying the exception.
