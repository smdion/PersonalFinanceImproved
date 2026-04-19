# Ledgr — Design & Architecture

## Tech Stack

| Layer     | Technology                             | Notes                                                                         |
| --------- | -------------------------------------- | ----------------------------------------------------------------------------- |
| Framework | Next.js 14+ (App Router), TypeScript   | Full-stack, `pnpm` package manager                                            |
| Styling   | Tailwind CSS + custom components       | shadcn/ui available but mostly custom Tailwind                                |
| Charts    | Custom Tailwind bar charts             | Recharts available for future enhancement                                     |
| Database  | SQLite (default) or PostgreSQL         | `DATABASE_URL` controls dialect; SQLite zero-config, PG for shared/production |
| ORM       | Drizzle ORM                            | Returns decimals as strings; `toNumber()` converts                            |
| API       | tRPC                                   | End-to-end type safety, Zod validation                                        |
| Auth      | Auth.js (NextAuth v5) + Authentik OIDC | Admin + Viewer roles                                                          |
| Hosting   | Self-hosted Docker on homelab          | SWAG reverse proxy, hardened compose (read-only fs, cap_drop ALL)             |

---

## Implementation Status

| Phase                                 | Status          | Notes                                                                                                                                                                                                                                                                     |
| ------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1: Skeleton + Data Model + Seed | **COMPLETE**    | Schema (<!-- AUTO-GEN:migrations -->5<!-- /AUTO-GEN --> migration, <!-- AUTO-GEN:tables -->56<!-- /AUTO-GEN -->+ tables), seed script, <!-- AUTO-GEN:settingsComponents -->17<!-- /AUTO-GEN --> settings tabs                                                             |
| Phase 2: Calculation Engine           | **COMPLETE**    | <!-- AUTO-GEN:calculators -->16<!-- /AUTO-GEN --> calculators + modular engine (<!-- AUTO-GEN:engineModules -->19<!-- /AUTO-GEN --> modules)                                                                                                                              |
| Phase 3: Dashboard + Core Pages       | **COMPLETE**    | Dashboard (<!-- AUTO-GEN:dashboardCards -->21<!-- /AUTO-GEN --> dashboard card components), Paycheck, Budget, Portfolio                                                                                                                                                   |
| Phase 4: Budget API Integration       | **COMPLETE**    | YNAB + Actual Budget clients, sync router, cache, factory. Cash integration (API owns cash when active), budget 2-way sync, savings category sync, portfolio auto-push on snapshot, asset pull on sync, account mappings, expense YoY comparison, API category picker UI. |
| Phase 5: Remaining Pages              | **COMPLETE**    | Performance, Net Worth, Retirement (+ 3 methodology sub-pages), Mortgage, Savings, Historical, Settings, Tools                                                                                                                                                            |
| Phase 6: Polish + Deployment          | **IN PROGRESS** | UI review complete: shared primitives (Button, Badge, Skeleton, EmptyState), projection decomposition (8.3K→1.8K lines), responsive grids, Button adoption, Skeleton adoption, color standardization, design system docs. Remaining: Docker, SWAG, monitoring.            |

### What's Built

- **<!-- AUTO-GEN:pages -->27<!-- /AUTO-GEN --> pages:** Dashboard, Paycheck, Budget, Portfolio, Performance, Net Worth, Retirement (+ Methodology, Accumulation Methodology, Decumulation Methodology), Mortgage, Assets, Savings, Historical, Settings, Tools (ESPP calculator, Relocation calculator), Contributions, Data Browser, Expenses, Help, House, Liabilities, Versions, Brokerage, Analytics
- **<!-- AUTO-GEN:calculators -->16<!-- /AUTO-GEN --> calculators:** paycheck, tax, budget, contribution, mortgage, net-worth, savings, efund, expense-yoy, brokerage-goals, monte-carlo, random (distributions), relocation
- **Modular engine:** `lib/calculators/engine/` — <!-- AUTO-GEN:engineModules -->19<!-- /AUTO-GEN --> modules (projection orchestrator, year handlers, contribution routing, withdrawal routing, tax estimation, override resolution, balance utils/deduction, individual account tracking, growth application, RMD enforcement, post-withdrawal optimizer, spending strategies: Guyton-Klinger, Vanguard Dynamic, Constant Percentage, Endowment, Spending Decline, Forgo Inflation, RMD Spending)
- **<!-- AUTO-GEN:primaryRouters -->20<!-- /AUTO-GEN --> primary tRPC routers + <!-- AUTO-GEN:settingsSubRouters -->6<!-- /AUTO-GEN --> settings sub-routers** + shared helpers
- **<!-- AUTO-GEN:settingsComponents -->17<!-- /AUTO-GEN --> settings components**
- **<!-- AUTO-GEN:dashboardCards -->21<!-- /AUTO-GEN --> dashboard card components**

---

## Major Refactors

Two foundational refactors shaped the current architecture. All new code must follow the patterns they established.

### Refactor 1: Data-Driven Architecture (Overall Refactor)

**Intent:** Eliminate all hardcoded account type knowledge from the codebase. Before this refactor, 150+ locations across 25+ files contained `if (category === '401k')` checks, duplicated label maps, hardcoded `['401k', '403b', 'hsa', 'ira', 'brokerage']` arrays, literal type unions, and heuristic matchers.

**Result:** All account-type behavior is now declared in a single config record (`ACCOUNT_TYPE_CONFIG` in `src/lib/config/account-types.ts`). The codebase is generic infrastructure that reads config properties. Adding a new account type requires adding one config entry — zero code changes elsewhere.

See RULES.md § Data-Driven Architecture for the full rules. The refactoring established config-driven behavior via `ACCOUNT_TYPE_CONFIG`.

### Refactor 2: Engine Decomposition (Engine Refactor)

**Intent:** The retirement engine grew to ~3100 lines in a single file with an implicit ordering contract between 7 sequential post-withdrawal operations. The refactor extracted each concern into a focused module while preserving identical behavior.

**Result:** `lib/calculators/engine/` now contains <!-- AUTO-GEN:engineModules -->19<!-- /AUTO-GEN --> modules with explicit interfaces. Each module has a single responsibility and clear inputs/outputs. The orchestrator (`projection.ts`) calls modules in a defined pipeline order. The public API surface is minimal (`calculateProjection()` + `calculateContributionEngine()` + tax helpers).

See RULES.md § Engine Modularity for the full module list (<!-- AUTO-GEN:engineModules -->19<!-- /AUTO-GEN --> modules) and rules. The orchestrator calls modules in an explicit pipeline order.

---

## Project Structure

Run `ls src/lib/ src/components/ src/server/routers/` for the live layout.
Key concept → directory map:

| Concept                 | Directory                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Calculators (pure)      | `src/lib/calculators/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Engine modules          | `src/lib/calculators/engine/` (<!-- AUTO-GEN:engineModules -->19<!-- /AUTO-GEN --> modules)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Calculator I/O types    | `src/lib/calculators/types.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Config tables (declare) | `src/lib/config/` (account types, tax, RMD, IRMAA, ACA)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| DB schema               | `src/lib/db/schema.ts` (<!-- AUTO-GEN:tables -->56<!-- /AUTO-GEN -->+ tables)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| tRPC routers            | `src/server/routers/` (<!-- AUTO-GEN:primaryRouters -->20<!-- /AUTO-GEN --> primary + <!-- AUTO-GEN:settingsSubRouters -->6<!-- /AUTO-GEN --> settings sub-routers)                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Auth + tRPC middleware  | `src/server/auth.ts`, `src/server/trpc.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Pages (App Router)      | `src/app/(dashboard)/` (<!-- AUTO-GEN:pages -->27<!-- /AUTO-GEN --> pages)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Shared UI primitives    | `src/components/ui/` (<!-- AUTO-GEN:uiComponents -->21<!-- /AUTO-GEN --> components)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Domain components       | `src/components/{paycheck,budget,savings,networth,performance,mortgage,settings}/` — paycheck (<!-- AUTO-GEN:paycheckComponents -->16<!-- /AUTO-GEN -->), budget (<!-- AUTO-GEN:budgetComponents -->13<!-- /AUTO-GEN -->), savings (<!-- AUTO-GEN:savingsComponents -->25<!-- /AUTO-GEN -->), networth (<!-- AUTO-GEN:networthComponents -->9<!-- /AUTO-GEN -->), performance (<!-- AUTO-GEN:performanceComponents -->11<!-- /AUTO-GEN -->), mortgage (<!-- AUTO-GEN:mortgageComponents -->8<!-- /AUTO-GEN -->), settings (<!-- AUTO-GEN:settingsComponents -->17<!-- /AUTO-GEN -->) |
| Dashboard cards         | `src/components/cards/` (<!-- AUTO-GEN:dashboardCards -->21<!-- /AUTO-GEN --> cards)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Budget API clients      | `src/lib/budget-api/` (YNAB + Actual)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Migrations              | `drizzle/` (<!-- AUTO-GEN:migrations -->5<!-- /AUTO-GEN --> migration, v0.5 squashed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Scripts                 | `scripts/` (seed, validate, verify-docs, release)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Tests                   | `tests/` (Vitest)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Docs                    | `docs/RULES.md`, `docs/DESIGN.md`, `docs/TESTING.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

---

## Architecture Decisions

### tRPC (not REST)

Single-frontend, single-backend app with two users. tRPC gives end-to-end type safety, zero boilerplate, automatic Zod validation.

**Middleware:**

- `publicProcedure` → no auth (health check)
- `protectedProcedure` → valid session required (all queries)
- `adminProcedure` → Admin role + mutation logging
- `withPermission(p)` → factory producing permission-gated procedures (admin always passes)

### Authentication & RBAC

Auth.js with Authentik OIDC. Base roles + permission addons:

**Base roles:** `admin` | `viewer`

- **Admin**: Full access (implicitly has all permissions)
- **Viewer**: Read-only baseline

**Permission addons** (independent, mix-and-match via Authentik groups):

| Authentik Group     | Permission    | Grants                                            |
| ------------------- | ------------- | ------------------------------------------------- |
| `ledgr-admin`       | (admin role)  | Full access to everything                         |
| `ledgr-scenario`    | `scenario`    | Create/edit/delete scenarios + overrides          |
| `ledgr-portfolio`   | `portfolio`   | Create/delete portfolio snapshots                 |
| `ledgr-performance` | `performance` | Manage performance accounts + account performance |
| `ledgr-budget`      | `budget`      | Edit budget items, columns, profiles              |
| `ledgr-savings`     | `savings`     | Manage savings goals, transactions, allocations   |
| `ledgr-brokerage`   | `brokerage`   | Manage brokerage goals + planned transactions     |
| `ledgr-sync`        | `sync`        | Trigger budget API sync operations                |

Route-level protection via Next.js middleware on `/(dashboard)` routes. Permission enforcement at tRPC procedure level. UI gating via `UserContext` (`useUser()`, `hasPermission()`, `isAdmin()`).

### Server/Client Component Boundary

| Layer                 | Type                    | Examples                   |
| --------------------- | ----------------------- | -------------------------- |
| Page shells           | Server (`page.tsx`)     | Data prefetching, layout   |
| Dashboard layout      | Server (`layout.tsx`)   | Auth wrapper, sidebar      |
| Charts, tables, forms | Client (`'use client'`) | All interactive components |

### Settings Architecture

See RULES.md § Settings Belong on Their Pages for the full domain-to-page mapping.

Each page owns its domain's settings inline. The central Settings page only holds cross-cutting reference data (People, Jobs, IRS Limits, Tax Brackets, etc.).

---

## Color System

All account type and tax treatment colors are centralized in `lib/utils/colors.ts`. No Tailwind color classes for these domains should be hardcoded in components.

### Account Types (contribution accounts, bars, badges)

| Type      | Fill       | Light      | Border     | Text       |
| --------- | ---------- | ---------- | ---------- | ---------- |
| 401k      | blue-600   | blue-100   | blue-300   | blue-700   |
| 403b      | indigo-600 | indigo-100 | indigo-300 | indigo-700 |
| IRA       | purple-600 | purple-100 | purple-300 | purple-700 |
| HSA       | teal-600   | teal-100   | teal-300   | teal-700   |
| Brokerage | amber-600  | amber-100  | amber-300  | amber-700  |

Helpers: `accountColor()`, `accountMatchColor()`, `accountBorderColor()`, `accountTextColor()`

### Tax Treatments (portfolio breakdowns, retirement projections)

| Type        | Key      | Fill (bars) | Text (labels) | Label       |
| ----------- | -------- | ----------- | ------------- | ----------- |
| Traditional | preTax   | blue-500    | blue-600      | Traditional |
| Roth        | taxFree  | violet-500  | purple-600    | Roth        |
| HSA         | hsa      | emerald-500 | green-600     | HSA         |
| After-Tax   | afterTax | orange-500  | orange-600    | After-Tax   |

Helpers: `taxTypeColor()`, `taxTypeTextColor()`, `taxTypeLabel()`

**Label convention:** The DB stores IRS bucket keys (`preTax`/`taxFree`/`hsa`/`afterTax`) — these are the correct data model. The UI displays user-friendly labels via `taxTypeLabel()`: `preTax → "Traditional"`, `taxFree → "Roth"`. These are the terms on Vanguard statements, 401k enrollment, and finance articles. IRS-level context is available in `TAX_BUCKET_DESCRIPTIONS` tooltips (e.g. "Traditional (pre-tax) contributions..."). Payroll terms like "Pre-Tax Deductions" on pay stubs are a different concept (payroll section headers) and are not changed.

### Design Rules

- Account types and tax treatments use distinct hue families — no overlap
- Generic UI badges (BG, PC, etc.) use indigo or gray to avoid collision
- Account type colors are derived from `ACCOUNT_TYPE_CONFIG` — adding a new account type with a `colors` block automatically wires it up in `colors.ts`
- **Portfolio scope:** "All accounts" = every account from the latest balance snapshot. "Retirement accounts" = only accounts with `parentCategory = 'Retirement'`. Retirement ⊂ Portfolio.
- **Data freshness:** A global sidebar indicator shows when balance and performance data were last updated. Individual pages do not duplicate this information.
- **ID-based entity matching:** All cross-entity references use stable database IDs, never display names or labels. `AccountMapping.localId` uses the format `"performance:{id}" | "asset:{id}" | "mortgage:{loanId}:{type}"`. Savings goals match by `goalId`, mortgage results carry `loanId`, asset class overrides/correlations/glide paths use numeric `id` keys, and person/owner matching uses `ownerPersonId`. Display names are cached in `localName` (mappings) or computed via `accountDisplayName()` — but never used for identity resolution.

---

## Portfolio ↔ Performance Integration

### Data Flow

```
Portfolio Snapshot (weekly balance entry)
    ↓ auto-updates ending_balance
Performance: account_performance (current year rows)
    ↓ category rollups
Performance: annual_performance (computed sums)
```

### Performance Accounts

Master registry of 17 investment accounts (`performance_accounts` table). Each is self-describing with `accountType`, `subType`, `label`, and `ownerPersonId` columns. Each spans all years and links to both `account_performance` (historical tracking) and `portfolio_accounts` (snapshot rows) via FK.

Portfolio snapshots are more granular than performance accounts — multiple snapshot rows map to one performance account (e.g., 401k Roth + 401k Trad + Employer Match → one "Alice 401k (Fidelity)" performance account).

#### Account Naming

`accountLabel` is **server-computed** via `buildAccountLabel()` using the formula: `{Owner} {Label?} {SubType || Type} ({Institution})`. Examples:

- Alice + 401k + Fidelity → `"Alice 401k (Fidelity)"`
- Bob + HSA + Voya → `"Bob HSA (Voya)"`
- Joint + IRA + Vanguard → `"IRA (Vanguard)"`
- Joint + brokerage + "Long Term" label + Vanguard → `"Long Term Brokerage (Vanguard)"`
- Bob + brokerage + ESPP subType + UBS → `"Bob ESPP (UBS)"`

`displayName` is an optional user override. All display uses `accountDisplayName()` from `format.ts`, which returns `displayName` (if set) → `accountLabel` (programmatic) → fallback construction. Every router and component must use this helper — no inline `displayName ?? accountLabel` ternaries.

### Snapshot Display (Grouped by Performance Account)

Portfolio snapshot history and the new snapshot form group rows by their parent `performanceAccount`, sorted by institution then account name. Each group shows a header with the account name (via `accountDisplayName()`) and a subtotal, with indented sub-rows beneath.

**Sub-row labels** follow two rules:

1. **Owner prefix**: Shown only when the performance account is joint (no individual owner) AND sub-rows have different `ownerPersonId` values. Example: "IRA (Vanguard)" has sub-rows "Alice — Roth" and "Bob — Roth".
2. **Sub-account type**: When `subType` is present on the portfolio row (e.g., "Rollover", "Employer Match", "ESPP"), it's shown with the tax type in parentheses. When `subType` is null, the raw `accountType` is shown only if it differs from the parent performance account's type — otherwise just the tax type label.

**Example output:**

```
Alice 401k (Fidelity)                             $180,000.00
    Roth                                              $75,000.00
    Traditional                                          $500.00
    Employer Match (Traditional)                     $20,000.00
    Rollover (Traditional)                           $84,500.00

IRA (Vanguard)                                    $260,000.00
    Alice — Roth                                    $90,000.00
    Bob — Roth                                     $170,000.00
```

**Data flow**: The `getSnapshots` router query LEFT JOINs `performanceAccounts` and `people` to return `perfAccountLabel`, `perfDisplayName`, `perfAccountType`, `perfOwnerPersonId`, `ownerName`, and `subType` per portfolio row. Grouping logic lives in the component (`groupByPerformanceAccount()` for history, `groupFormRows()` for the new snapshot form).

### Current Year vs Finalized Years

- **Finalized years** (2012–2025): Stored as-is, trusted as source data
- **Current year** (2026): `ending_balance` auto-updated from latest snapshot; other fields manually entered; "In Progress" badge displayed

### Row Synthesis

For years with `account_performance` data but missing `annual_performance` category rows, synthetic rows are computed at read time. Single-category years copy from the stored annual row to avoid account-level sum discrepancies.

### Return % (Modified Dietz)

```
return = gain_loss / (beginning_balance + (contributions + employer_contributions - distributions) / 2)
```

Stored values trusted. Null values computed. Division-by-zero returns null.

### Finalization Flow

1. Review all data
2. Click "Finalize [year]"
3. Set `is_finalized = true`, `is_current_year = false`
4. Write point-in-time derived data to `net_worth_annual` (e.g., `portfolio_by_tax_location` from the snapshot's `portfolio_accounts` grouped by `parent_category` + `tax_type`)
5. Auto-create next year's rows with `beginning_balance = ending_balance`

**Finalization captures point-in-time state.** `net_worth_annual` is the authoritative source for all historical year-level financial data. Portfolio snapshots and performance records are the raw inputs; `net_worth_annual` is the finalized output. Data that cannot be reconstructed from current state (e.g., tax location from a snapshot that may later be pruned) must be stored at finalization time.

**`buildYearEndHistory()` is the single reader.** All year-level financial data flows through this helper. Finalized years read from `net_worth_annual`. The current year is built from live snapshot/performance/settings. No procedure should independently assemble year-level financial data — read from `buildYearEndHistory()` instead.

---

## Calculator Architecture

Each calculator follows the same pattern:

```typescript
// lib/calculators/types.ts — ALL types live here, decoupled from Drizzle
type XxxInput = { /* all number, never Drizzle string */ asOfDate: Date; };
type XxxResult = { /* outputs */ warnings: string[]; };

// lib/calculators/xxx.ts — pure function
export function calculateXxx(input: XxxInput): XxxResult { ... }
```

**tRPC routers** fetch from DB, convert strings via `toNumber()`, call calculators, return typed results.

### Key Calculators

| Calculator       | Key Output                                                                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paycheck         | Per-period breakdown, year schedule (SS cap transition), bonus estimate                                                                                                                |
| Tax              | Effective/marginal rates, total liability                                                                                                                                              |
| Budget           | Tier totals, essential/discretionary split                                                                                                                                             |
| Contribution     | Utilization %, savings rate vs 25% target, "money left on table"                                                                                                                       |
| Mortgage         | Amortization schedule, payoff projection, interest savings                                                                                                                             |
| Engine (modular) | Unified accumulation + distribution projection with bracket-filling withdrawals, RMDs, Roth conversions, SS tax torpedo, LTCG brackets, Guyton-Klinger guardrails, IRMAA/ACA awareness |
| Net Worth        | Wealth Score, FI progress, tax-bucket allocation                                                                                                                                       |
| Savings          | Months of coverage, goal projections                                                                                                                                                   |
| E-Fund           | Essential expense coverage months                                                                                                                                                      |
| Brokerage Goals  | View enricher: maps engine projection to per-goal status (funded/shortfall/tax cost)                                                                                                   |
| Monte Carlo      | 1,000+ trial simulation with asset class correlations, glide path allocations, configurable presets                                                                                    |
| Random           | Distribution utilities (normal, log-normal) for Monte Carlo                                                                                                                            |
| Relocation       | Budget comparison, FI target/age impact, earliest safe relocation, large purchase modeling                                                                                             |

### Relocation Calculator

The relocation decision tool (`lib/calculators/relocation.ts`) compares two budget scenarios year-by-year:

- **Core**: Computes expense delta, savings rate impact, FI target under each scenario, FI age under each scenario, recommended portfolio before relocating, and earliest safe relocation age.
- **Year adjustments**: Override relocation expenses for specific years (phase-in, cost cuts). Client-side state, not persisted.
- **Contribution overrides**: Override contribution rate (% of salary) for specific years. Sticky forward — each applies until the next override.
- **Large purchases** (`RelocationLargePurchase`): Generic one-time/financed purchases tied to relocation (home, car, furniture). ONE data shape, ONE calculation path:

| Field                | Purpose                                            | Default        |
| -------------------- | -------------------------------------------------- | -------------- |
| `name`               | Display label                                      | required       |
| `purchasePrice`      | Total cost                                         | required       |
| `downPaymentPercent` | Cash portion as decimal (0.20 = 20%)               | 1.0 (all-cash) |
| `loanRate`           | Annual interest rate for financed portion          | —              |
| `loanTermYears`      | Loan duration                                      | —              |
| `ongoingMonthlyCost` | Recurring monthly cost (tax, insurance, HOA, etc.) | 0              |
| `saleProceeds`       | Net from selling existing asset                    | 0              |
| `purchaseYear`       | Calendar year of purchase                          | required       |

**How purchases affect the projection:**

1. **Purchase year**: Portfolio withdraws `purchasePrice × downPaymentPercent` (cash outlay), adds `saleProceeds`. Net impact shown in `largePurchaseImpact`.
2. **Loan payments**: Monthly amortization payment added to relocation expenses for `loanTermYears` starting at `purchaseYear`.
3. **Ongoing costs**: Added to relocation expenses from `purchaseYear` onward (permanent).
4. **FI target**: Increased by ongoing costs (they're retirement expenses too). Loan payments do NOT increase FI target (they end).

### Contribution/Distribution Engine

The unified engine (`lib/calculators/engine/`) is decomposed into 20 focused modules with a clean public API exported from `engine/index.ts`. The engine was originally a single ~3100-line file; the engine refactor extracted each concern into its own module while preserving identical behavior.

**Public API** (from `engine/index.ts`):

- `calculateProjection()` — Full accumulation + decumulation projection
- `calculateContributionEngine()` — Contribution routing only (used by paycheck/contribution pages)
- Tax estimation helpers

**Module responsibilities:**

| Module                           | Responsibility                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `projection.ts`                  | Orchestrator — accumulation loop, decumulation loop, phase transition                             |
| `contribution-routing.ts`        | Per-account contribution allocation, IRS limit enforcement, overflow to brokerage, employer match |
| `withdrawal-routing.ts`          | Bracket-filling, waterfall, and percentage withdrawal modes                                       |
| `tax-estimation.ts`              | SS torpedo convergence (3-tier, 2-iteration), effective tax rate gross-up                         |
| `override-resolution.ts`         | Sticky-forward per-year config resolution                                                         |
| `balance-utils.ts`               | Balance cloning, type conversion helpers                                                          |
| `balance-deduction.ts`           | Withdrawal deduction, clamping, depletion tracking                                                |
| `individual-account-tracking.ts` | Per-account bookkeeping (contributions, growth, withdrawals)                                      |
| `growth-application.ts`          | Return rate application on all balance structures                                                 |
| `rmd-enforcement.ts`             | IRS Uniform Lifetime Table lookup, forced Traditional distributions                               |
| `post-withdrawal-optimizer.ts`   | Roth conversions, IRMAA awareness, ACA subsidy awareness                                          |
| `guyton-klinger.ts`              | Dynamic spending guardrails (upper/lower rails, prosperity rule)                                  |

The engine handles both phases in a single pass:

1. **Accumulation** (current age → retirement): per-account contribution routing (waterfall or percentage mode), IRS limit enforcement with overflow to brokerage, employer match, salary growth with cap, tax splits (Roth/Traditional)
2. **Distribution** (retirement → end): tax-optimal bracket-filling withdrawals by default. Three routing modes:
   - **Bracket filling** (default): fill traditional withdrawals up to a target marginal bracket cap, then Roth (tax-free), then brokerage (capital gains rate), HSA last (most tax-advantaged). Requires `rothBracketTarget` + tax brackets; falls back to waterfall if missing.
   - **Waterfall mode**: drain accounts in priority order with per-account and per-tax-type caps. Roth bracket optimization can overlay via `rothBracketTarget`.
   - **Percentage mode**: split withdrawals by fixed % across accounts with proportional redistribution
   - **Tax bracket estimation**: `estimateEffectiveTaxRate()` uses actual W-4 withholding brackets, with configurable tax multiplier for future rate scenarios
   - **Withdrawal strategies**: Fixed (inflation-adjusted, 4% rule) or Guyton-Klinger guardrails (dynamic spending adjustment based on portfolio performance — configurable upper/lower guardrails, increase/decrease percentages, prosperity rule)
   - Social Security offset with IRS provisional income formula (3-tier SS taxation, 2-iteration convergence), inflation-adjusted expenses, per-year sticky-forward overrides
3. **Tax-aware features** (config-driven lookup tables in `lib/config/`):
   - **RMDs** (`rmd-tables.ts`): IRS Uniform Lifetime Table, SECURE 2.0 start ages (72/73/75 by birth year). Post-routing enforcement forces additional Traditional withdrawals when needed.
   - **LTCG brackets** (`tax-tables.ts`): Graduated 0%/15%/20% rates by filing status and total taxable income.
   - **Roth conversions**: Automatic Traditional→Roth conversion to fill remaining bracket room after withdrawals. Tax paid from brokerage. Configurable target bracket.
   - **IRMAA awareness** (`irmaa-tables.ts`): Medicare Part B+D cliff-based surcharges (age 65+). Reports cost and warns when conversions push MAGI over a cliff.
   - **ACA subsidy awareness** (`aca-tables.ts`): Pre-65 health insurance subsidy cliff (400% FPL). Reports MAGI headroom and warns when subsidy is lost.

All settings (routing mode, withdrawal order, tax splits, caps, Roth conversions, G-K params, IRMAA/ACA awareness) can be overridden per-year.

### Contribution Engine (UI Card)

The contribution engine card (`components/cards/contribution-engine.tsx`) unifies contribution data with the engine projection into a single interactive view. Both the dashboard summary card and the retirement page use the same `getContributionEngine` endpoint.

- **Per-person filtering:** Joint/Person toggle scales the balance projection graph, year-by-year table, and hero KPIs by estimated person share (computed from `contribSpecs` proportions).
- **Contribution specs:** "How Contributions Are Projected" section shows per-account details with employer match displayed inline (`+m` indicator with hover breakdown). Match is redistributed proportionally when a person has both Roth and Traditional accounts in the same category.
- **Column group headers:** Year-by-year table uses "Contributions" and "Balances" group headers for visual clarity.
- **Withdrawal Strategy panel:** 3-way toggle (Bracket Filling / Waterfall / Percentage) with contextual help text. Bracket filling is default; waterfall order editor and tax preference dropdowns conditionally hidden when bracket filling is active.
- **Balance hover tooltips:** All balance columns (per-tax-type and total) show contextual tooltips — tax bucket breakdown ($ and %), contribution/withdrawal sources per slot, employer match attribution by tax treatment, and pro-rate note for current year. In/Out column shows match with `+m` indicator in both phases; decumulation In/Out shows Traditional/Roth/Brokerage/HSA/Tax cost breakdown.

Shared helpers power the data:

- `getAccountTypeConfig()` — central config for all account-type behavior (from `src/lib/config/account-types.ts`)
- `aggregateContributionsByCategory()` — single-pass aggregation of contributions + employer match per category (in `helpers.ts`)
- `buildContributionDisplaySpecs()` — per-record specs with match redistribution, used by both retirement and contribution routers (in `helpers.ts`)

### Tooltip System

Tooltip rendering for the projection card is data-driven and lives in
`src/components/cards/projection/tooltip-renderer.tsx`. Call sites build a
`TooltipData` object (discriminated union: `kind: 'money' | 'info'`) and pass
it to `renderTooltip()`. The renderer decides _how_ to render — never _what_
data to show. Section order is fixed; every section is `{d.field && <render>}`.

Helper modules (`utils.ts`, `use-projection-derived.ts`, `types.ts`) hold the
data-driven lookups (`bucketSlotMap`, `colKeyParts`, `itemTaxType`, etc.).
Keep the field-by-field contract in the file header comment of
`tooltip-renderer.tsx` — not here.

---

## Savings Page Architecture

The Savings page has three sections, each tracking a different savings strategy:

### 1. Emergency Fund (Cash)

Months of essential expenses covered. Uses `efund` calculator with budget tier selection.

### 2. Sinking Funds (Cash)

Monthly-contribution goals for near-term purchases. Managed via `savings` calculator with planned transactions and allocation overrides.

### 3. Long-Term Goals (Brokerage)

Yearly brokerage-funded goals (e.g., new car in 2030). Unlike sinking funds held in cash, these are invested and subject to capital gains tax on the gains portion.

**Engine-integrated architecture:** Long-term goals are processed inside the contribution engine's accumulation loop — not a standalone calculator. This ensures:

- Goal withdrawals reduce the brokerage balance before retirement decumulation sees it (holistic rule)
- Cost basis is tracked accurately (contributions increase basis 1:1, growth does not, withdrawals reduce basis proportionally via average basis method)
- Tax on withdrawals is computed on gains only (`withdrawal - basisPortion`) at the `distributionTaxRateBrokerage` rate

**Data flow:**

```
brokerage_goals table → retirement router → engine input (brokerageGoals)
    → engine accumulation loop processes withdrawals by target year + priority
    → engine output (brokerageGoalWithdrawals per year)
    → brokerage-goals calculator (view enricher) maps to per-goal status
```

**Schema:** `brokerage_goals` table (id, name, target_amount, target_year, priority, is_active, notes). Cost basis tracked in `app_settings` as `brokerage_cost_basis`.

**UI:** CRUD cards in `components/cards/brokerage-goals.tsx` with summary KPIs (total commitments, active goals count).

---

## Profile & Scenario Layering

Resolution order (each layer patches on top of previous):

1. **Database (live data)** — base truth
2. **Contribution profile** — persistent named overrides for salary, contributions, match, bonus
3. **Budget profile** — persistent named budget column selection
4. **Scenario** — temporary what-if overrides for jobs, contributions, app settings, retirement assumptions

Rules:

- Contribution profiles and scenarios are complementary, not competing
- A contribution profile sets a persistent baseline ("max 401k", "new job at $200k")
- A scenario layers temporary adjustments on top ("retire at 60", "expenses +3%")
- Both active simultaneously = profile resolves first, scenario patches on top
- Budget profiles are independent — they select which budget column to use, not override individual values
- Default/Live profile = no-op (identical to no profile selected)

---

## Pragmatic Deviations

Documented deviations from general architectural rules, kept for pragmatic reasons:

1. **Resolution helper lives in `helpers.ts`, not `override-resolution.ts`**: Profile resolution requires DB access. The engine layer (`lib/calculators/engine/`) is pure functions with no DB. Splitting into two layers adds complexity without proportional benefit at current scale. Revisit if override resolution logic grows beyond ~50 lines.

2. **Zod validation for override shapes is manually defined, not derived from config**: Deriving from Drizzle schema or `ACCOUNT_TYPE_CONFIG` adds abstraction with risk of rejecting valid overrides if derivation logic has bugs. Manual schema is easier to audit and maintain at current field count (~12 overridable fields). Revisit if overridable fields exceed ~25 or schema changes frequently.

3. **Contribution profiles and scenarios remain separate systems**: Both are named override collections, but they serve different scopes (contributions vs. whole-plan what-ifs) and compose as layers. Documented precedence: DB base → contribution profile → budget profile → scenario. Revisit if a third profile type is introduced.

---

## Deployment (Phase 6 — Not Started)

| Concern          | Implementation                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Dockerfile       | 3-stage build (deps → builder → runner), `node:24-alpine` pinned to digest, standalone output                                             |
| Compose          | Hardened: `read_only`, `cap_drop: ALL`, `no-new-privileges`, `127.0.0.1` port binding, CPU+memory limits                                  |
| Proxy            | SWAG reverse proxy via `homelab.proxy.*` container labels                                                                                 |
| Health           | `GET /api/health` — simple probe (status + version). `GET /api/health/detailed` — authenticated (pool stats, budget API, sync timestamps) |
| Security headers | CSP (no `unsafe-eval`), HSTS, X-Frame-Options DENY, Permissions-Policy                                                                    |
| Monitoring       | Structured JSON logging, Grafana dashboard, Discord alerting                                                                              |
| Migrations       | `db-migrate.ts` compiled to JS via esbuild, runs as `node db-migrate.js` in entrypoint                                                    |
| Secrets          | All in `vars/secrets.yaml`, rendered via Ansible `env.j2` template                                                                        |

### Human Actions Required

| Task                          | Status                    |
| ----------------------------- | ------------------------- |
| PostgreSQL database           | Done                      |
| Authentik app registration    | Partial (dev-mode bypass) |
| `app_definitions.yaml` entry  | Pending                   |
| YNAB API token                | Pending                   |
| Vault secrets                 | Pending                   |
| SWAG proxy labels             | Pending                   |
| Semaphore template            | Pending                   |
| DNS record                    | Pending                   |
| Fresh xlsx export for cutover | Pending                   |

---

## Design System

Shared UI primitives live in `src/components/ui/`. Import from the barrel (`@/components/ui`) or directly.

### Design Tokens

Defined in `src/app/globals.css` as CSS custom properties with light/dark overrides.

**Surfaces:**

| Tailwind class         | Use                                   |
| ---------------------- | ------------------------------------- |
| `bg-surface-primary`   | Card/panel background                 |
| `bg-surface-secondary` | Page sections, secondary panels       |
| `bg-surface-elevated`  | Hover states, interactive surfaces    |
| `bg-surface-sunken`    | Recessed areas, code blocks           |
| `bg-surface-strong`    | Skeleton placeholders, strong accents |

**Text:**

| Tailwind class   | Use                         |
| ---------------- | --------------------------- |
| `text-primary`   | Headings, primary content   |
| `text-secondary` | Body text, descriptions     |
| `text-muted`     | Help text, secondary labels |
| `text-faint`     | Disabled text, timestamps   |

**Borders:** `border-default` (standard), `border-subtle` (dividers), `border-strong` (inputs, emphasized).

**Status colors** (use Tailwind scale directly):

| Context      | Classes                                                           |
| ------------ | ----------------------------------------------------------------- |
| Error        | `text-red-600`, `bg-red-50 border-red-200`                        |
| Warning      | `text-amber-600`, `bg-amber-50 border-amber-200`                  |
| Success      | `text-green-600`, `bg-green-50 border-green-200`                  |
| Info/link    | `text-blue-600 hover:text-blue-700`, `bg-blue-50 border-blue-200` |
| Danger hover | `hover:text-red-600`                                              |

### Component Catalog

Run `ls src/components/ui/` for the live list (<!-- AUTO-GEN:uiComponents -->21<!-- /AUTO-GEN --> components). Each
component exports a `*Props` type with the full prop contract — read the file
directly rather than maintaining a duplicate table here. Imports are barreled
via `@/components/ui` or available per-file (`@/components/ui/button`, etc.).

Anchor primitives (covered above): `Button`, `Badge`, `AccountBadge`, `Card`,
`Skeleton*`, `EmptyState`, `Tooltip`, `HelpTip`, `DataTable`, `PageHeader`,
`ErrorBoundary`. Imperative dialogs: `confirm()`, `promptText()`. Toast hook:
`useToasts()`.

### Layout Patterns

**Responsive grids** (never use `grid-cols-N` without a responsive prefix):

```
grid-cols-1 sm:grid-cols-3 gap-4      -- Summary cards
grid-cols-1 md:grid-cols-2 gap-6      -- Side-by-side sections
grid-cols-2 sm:grid-cols-4 gap-4      -- Stat grids
grid-cols-1 sm:grid-cols-2 gap-x-4    -- Data grids inside cards
```

**Page loading:**

```tsx
if (isLoading)
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-1/3" />
      <SkeletonChart />
    </div>
  );
if (error)
  return (
    <p className="text-red-600 text-sm">Failed to load: {error.message}</p>
  );
```

### File Organization

| Directory                    | Contains                                                 |
| ---------------------------- | -------------------------------------------------------- |
| `src/components/ui/`         | Shared primitives (Button, Card, Badge, Skeleton, etc.)  |
| `src/components/cards/`      | Domain card components (projection, MC, dashboard)       |
| `src/components/settings/`   | Settings page panels                                     |
| `src/components/portfolio/`  | Portfolio page components (contribution accounts, chart) |
| `src/components/historical/` | Historical page components (jobs, cells)                 |
| `src/components/mortgage/`   | Mortgage/liabilities components                          |
| `src/components/budget/`     | Budget page components                                   |
