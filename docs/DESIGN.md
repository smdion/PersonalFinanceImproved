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
| Phase 1: Skeleton + Data Model + Seed | **COMPLETE**    | Schema (<!-- AUTO-GEN:migrations -->3<!-- /AUTO-GEN --> migration, <!-- AUTO-GEN:tables -->54<!-- /AUTO-GEN -->+ tables), seed script, <!-- AUTO-GEN:settingsComponents -->17<!-- /AUTO-GEN --> settings tabs                                                             |
| Phase 2: Calculation Engine           | **COMPLETE**    | <!-- AUTO-GEN:calculators -->15<!-- /AUTO-GEN --> calculators + modular engine (<!-- AUTO-GEN:engineModules -->20<!-- /AUTO-GEN --> modules)                                                                                                                              |
| Phase 3: Dashboard + Core Pages       | **COMPLETE**    | Dashboard (<!-- AUTO-GEN:dashboardCards -->19<!-- /AUTO-GEN --> dashboard card components), Paycheck, Budget, Portfolio                                                                                                                                                   |
| Phase 4: Budget API Integration       | **COMPLETE**    | YNAB + Actual Budget clients, sync router, cache, factory. Cash integration (API owns cash when active), budget 2-way sync, savings category sync, portfolio auto-push on snapshot, asset pull on sync, account mappings, expense YoY comparison, API category picker UI. |
| Phase 5: Remaining Pages              | **COMPLETE**    | Performance, Net Worth, Retirement (+ 3 methodology sub-pages), Mortgage, Savings, Historical, Settings, Tools                                                                                                                                                            |
| Phase 6: Polish + Deployment          | **IN PROGRESS** | UI review complete: shared primitives (Button, Badge, Skeleton, EmptyState), projection decomposition (8.3K→1.8K lines), responsive grids, Button adoption, Skeleton adoption, color standardization, design system docs. Remaining: Docker, SWAG, monitoring.            |

### What's Built

- **<!-- AUTO-GEN:pages -->26<!-- /AUTO-GEN --> pages:** Dashboard, Paycheck, Budget, Portfolio, Performance, Net Worth, Retirement (+ Methodology, Accumulation Methodology, Decumulation Methodology), Mortgage, Assets, Savings, Historical, Settings, Tools (ESPP calculator, Relocation calculator), Contributions, Data Browser, Expenses, Help, House, Liabilities, Versions, Brokerage
- **<!-- AUTO-GEN:calculators -->15<!-- /AUTO-GEN --> calculators:** paycheck, tax, budget, contribution, mortgage, net-worth, savings, efund, expense-yoy, brokerage-goals, monte-carlo, random (distributions), relocation
- **Modular engine:** `lib/calculators/engine/` — <!-- AUTO-GEN:engineModules -->20<!-- /AUTO-GEN --> modules (projection orchestrator, year handlers, contribution routing, withdrawal routing, tax estimation, override resolution, balance utils/deduction, individual account tracking, growth application, RMD enforcement, post-withdrawal optimizer, spending strategies: Guyton-Klinger, Vanguard Dynamic, Constant Percentage, Endowment, Spending Decline, Forgo Inflation, RMD Spending)
- **<!-- AUTO-GEN:primaryRouters -->25<!-- /AUTO-GEN --> primary tRPC routers + <!-- AUTO-GEN:settingsSubRouters -->6<!-- /AUTO-GEN --> settings sub-routers** + shared helpers
- **<!-- AUTO-GEN:settingsComponents -->17<!-- /AUTO-GEN --> settings components**
- **<!-- AUTO-GEN:dashboardCards -->19<!-- /AUTO-GEN --> dashboard card components**

---

## Major Refactors

Two foundational refactors shaped the current architecture. All new code must follow the patterns they established.

### Refactor 1: Data-Driven Architecture (Overall Refactor)

**Intent:** Eliminate all hardcoded account type knowledge from the codebase. Before this refactor, 150+ locations across 25+ files contained `if (category === '401k')` checks, duplicated label maps, hardcoded `['401k', '403b', 'hsa', 'ira', 'brokerage']` arrays, literal type unions, and heuristic matchers.

**Result:** All account-type behavior is now declared in a single config record (`ACCOUNT_TYPE_CONFIG` in `src/lib/config/account-types.ts`). The codebase is generic infrastructure that reads config properties. Adding a new account type requires adding one config entry — zero code changes elsewhere.

See RULES.md § Data-Driven Architecture for the full rules. The refactoring established config-driven behavior via `ACCOUNT_TYPE_CONFIG`.

### Refactor 2: Engine Decomposition (Engine Refactor)

**Intent:** The retirement engine grew to ~3100 lines in a single file with an implicit ordering contract between 7 sequential post-withdrawal operations. The refactor extracted each concern into a focused module while preserving identical behavior.

**Result:** `lib/calculators/engine/` now contains <!-- AUTO-GEN:engineModules -->20<!-- /AUTO-GEN --> modules with explicit interfaces. Each module has a single responsibility and clear inputs/outputs. The orchestrator (`projection.ts`) calls modules in a defined pipeline order. The public API surface is minimal (`calculateProjection()` + `calculateContributionEngine()` + tax helpers).

See RULES.md § Engine Modularity for the full module list (<!-- AUTO-GEN:engineModules -->20<!-- /AUTO-GEN --> modules) and rules. The orchestrator calls modules in an explicit pipeline order.

---

## Project Structure

```
ledgr/
├── drizzle/                    # <!-- AUTO-GEN:migrations -->3<!-- /AUTO-GEN --> migration (v0.3 squashed schema)
├── scripts/
│   ├── seed.ts                 # xlsx parser + database seeder
│   ├── validate.ts             # Post-seed validation
│   ├── reseed-*.ts             # Targeted reseed scripts
│   ├── seed-*.ts               # Feature-specific seed scripts (tax, MC, scenarios)
│   └── migrate.ts              # Migration runner
├── src/
│   ├── middleware.ts            # Auth route protection (dev bypass / Authentik)
│   ├── app/
│   │   ├── (dashboard)/        # All authenticated pages
│   │   │   ├── layout.tsx      # Auth wrapper + sidebar
│   │   │   ├── dashboard-shell.tsx  # Dashboard shell component
│   │   │   ├── page.tsx        # Dashboard
│   │   │   ├── paycheck/ budget/ portfolio/ performance/
│   │   │   ├── networth/ retirement/ mortgage/ savings/
│   │   │   ├── assets/ historical/ settings/ brokerage/
│   │   │   ├── tools/          # ESPP calculator, Relocation calculator
│   │   │   ├── retirement/methodology/           # Engine methodology reference
│   │   │   ├── retirement/accumulation-methodology/
│   │   │   ├── retirement/decumulation-methodology/
│   │   │   └── loading.tsx, error.tsx
│   │   └── api/trpc/ health/
│   ├── components/
│   │   ├── ui/                 # <!-- AUTO-GEN:uiComponents -->21<!-- /AUTO-GEN --> shared components (EmptyState, HelpTip, PageHeader, AccountBadge, etc.)
│   │   ├── cards/              # Dashboard cards + projection card ('use client')
│   │   ├── charts/             # Chart wrappers ('use client')
│   │   ├── forms/              # Form components
│   │   ├── layout/             # DashboardLayout, Sidebar, DataFreshness, ScenarioBar
│   │   ├── paycheck/           # <!-- AUTO-GEN:paycheckComponents -->16<!-- /AUTO-GEN --> paycheck domain components
│   │   ├── budget/             # <!-- AUTO-GEN:budgetComponents -->8<!-- /AUTO-GEN --> budget domain components
│   │   ├── mortgage/           # <!-- AUTO-GEN:mortgageComponents -->8<!-- /AUTO-GEN --> mortgage domain components
│   │   ├── savings/            # <!-- AUTO-GEN:savingsComponents -->25<!-- /AUTO-GEN --> savings domain components
│   │   ├── networth/           # <!-- AUTO-GEN:networthComponents -->9<!-- /AUTO-GEN --> net worth visualization components
│   │   ├── performance/        # <!-- AUTO-GEN:performanceComponents -->9<!-- /AUTO-GEN --> performance tracking components
│   │   ├── settings/           # <!-- AUTO-GEN:settingsComponents -->17<!-- /AUTO-GEN --> settings sub-components
│   │   └── *-methodology-content.tsx  # 3 methodology content components
│   ├── lib/
│   │   ├── constants.ts        # App-wide constants (withdrawal rate, wealth score, FI thresholds)
│   │   ├── calculators/        # Pure functions (no DB, no side effects)
│   │   │   ├── types.ts        # All calculator I/O types (decoupled from Drizzle)
│   │   │   ├── engine/         # Modular projection engine (<!-- AUTO-GEN:engineModules -->20<!-- /AUTO-GEN --> modules)
│   │   │   │   ├── index.ts              # Public API barrel
│   │   │   │   ├── projection.ts         # Orchestrator (accumulation + decumulation)
│   │   │   │   ├── contribution-routing.ts
│   │   │   │   ├── withdrawal-routing.ts
│   │   │   │   ├── tax-estimation.ts
│   │   │   │   ├── override-resolution.ts
│   │   │   │   ├── balance-utils.ts
│   │   │   │   ├── balance-deduction.ts
│   │   │   │   ├── individual-account-tracking.ts
│   │   │   │   ├── growth-application.ts
│   │   │   │   ├── rmd-enforcement.ts
│   │   │   │   ├── post-withdrawal-optimizer.ts  # Roth conversions, IRMAA, ACA
│   │   │   │   └── guyton-klinger.ts
│   │   │   └── *.ts            # <!-- AUTO-GEN:calculators -->15<!-- /AUTO-GEN --> domain calculators
│   │   ├── config/
│   │   │   ├── account-types.ts    # Central account type config + all derived helpers
│   │   │   ├── display-labels.ts   # Consolidated label maps
│   │   │   ├── tax-tables.ts       # Federal tax brackets + FICA rates + LTCG brackets
│   │   │   ├── rmd-tables.ts       # IRS Uniform Lifetime Table + SECURE 2.0 start ages
│   │   │   ├── irmaa-tables.ts     # Medicare Part B+D cliff-based surcharge thresholds
│   │   │   └── aca-tables.ts       # ACA subsidy FPL lookup tables
│   │   ├── context/
│   │   │   ├── user-context.tsx     # Auth state, useUser(), hasPermission(), isAdmin()
│   │   │   └── scenario-context.tsx # Scenario overrides, useScenario()
│   │   ├── hooks/
│   │   │   ├── use-debounced-value.ts
│   │   │   ├── use-persisted-setting.ts  # Persist UI state to appSettings table
│   │   │   ├── use-salary-overrides.ts
│   │   │   ├── use-theme.ts
│   │   │   └── use-toast.ts
│   │   ├── db/
│   │   │   ├── index.ts        # Database connection
│   │   │   └── schema.ts       # All table definitions (<!-- AUTO-GEN:tables -->54<!-- /AUTO-GEN -->+ tables)
│   │   ├── budget-api/          # Budget API clients (YNAB, Actual Budget)
│   │   │   ├── index.ts              # Public API barrel
│   │   │   ├── interface.ts          # BudgetAPIClient interface
│   │   │   ├── types.ts              # Shared types (accounts, categories, transactions)
│   │   │   ├── conversions.ts        # Milliunit/cent ↔ dollar helpers
│   │   │   ├── ynab-client.ts        # YNAB implementation
│   │   │   ├── cache.ts              # budget_api_cache read/write/invalidate
│   │   │   └── factory.ts            # getBudgetAPIClient() — reads config, returns client
│   │   └── utils/
│   │       ├── math.ts         # safeDivide, roundToCents, sumBy
│   │       ├── date.ts         # Date helpers
│   │       ├── format.ts       # formatCurrency, formatPercent, formatDate, buildAccountLabel, accountDisplayName
│   │       └── colors.ts       # Centralized color system (account types + tax treatments)
│   └── server/
│       ├── routers/            # <!-- AUTO-GEN:primaryRouters -->25<!-- /AUTO-GEN --> primary tRPC routers + <!-- AUTO-GEN:settingsSubRouters -->6<!-- /AUTO-GEN --> settings sub-routers + helpers.ts + index.ts
│       ├── trpc.ts             # tRPC init + middleware (public/protected/admin/withPermission)
│       └── auth.ts             # Auth.js config (Authentik OIDC + dev credentials)
├── docs/
│   ├── RULES.md                # Philosophy & rules
│   ├── DESIGN.md               # This file
│   ├── TODO.md                 # Remaining work
│   ├── SNAPSHOT-PLAN.md        # State snapshot feature design
│   ├── API-DOCS-PLAN.md        # Auto-generated API docs design
│   └── Budget Overview.xlsx    # Source spreadsheet (seed data)
└── tests/                      # Vitest (configured, tests pending)
```

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

All tooltips in the contribution engine card are **data-driven**: call sites provide raw financial data, a single renderer decides what to show, in what order, with what styling. There is no per-tooltip layout logic — if a data field is present it renders; if absent it's omitted.

#### Architecture (3 layers)

**Layer 1 — Types & Data-Driven Helpers** (`contribution-engine.tsx`, top of file)

- **`TooltipData`**: Discriminated union — `kind: 'money'` (financial sections) or `kind: 'info'` (styled text lines). The `'money'` variant has ~17 optional fields (header, items, growth, yearChange, taxSplit, etc.)
- **`TooltipLineItem`**: One row — label, amount, optional `taxType`, optional `sub[]` children. Used for accounts, contributions, withdrawals.
- **`itemTaxType(category, taxField)`**: Pure function → `'roth' | 'traditional' | undefined`. 401k/403b/IRA always get a value; HSA/Brokerage return `undefined`. This is how `(Roth)` / `(Trad)` labels are automatic — call sites pass category + taxField, the renderer appends the suffix.

**Data-driven lookup helpers** (eliminate all if-chains for category/bucket/column resolution):

- **`catDisplayLabel`**: Record mapping category → display name (`'401k'→'401k'`, `'hsa'→'HSA'`, etc.). No ternary chains.
- **`colKeyParts(key)`**: Derives `{category, treatment}` from a column key like `'401k_roth'` → `{category: '401k', treatment: 'roth'}`. Used by all column-level helpers.
- **`colEngineTaxType(key)`**: Column key → engine taxType string (`'401k_roth'→'taxFree'`, `'hsa'→'hsa'`). Replaces per-site if-chains.
- **`colBalance(ba, key)`** / **`colWithdrawal(slots, key)`**: Read balance or sum withdrawals for a column key from engine data. One function, works for any category — no hardcoded branches.
- **`bucketSlotMap`**: Central config record mapping each tax bucket (`preTax`/`taxFree`/`hsa`/`afterTax`) to its slot contribution field, withdrawal field, category filter, spec treatment filter, tax display field, and match association flag. This is the single source of truth — adding a bucket means adding one entry here.
- **`slotBucketContrib(slot, bucket)`** / **`slotBucketWithdrawal(slot, bucket)`**: Read contribution or withdrawal from a slot for a bucket, driven by `bucketSlotMap`.
- **`filterSpecsForBucket(specs, bucket)`**: Filter contribution specs by tax treatment for a bucket, driven by `bucketSlotMap`.
- **`iaBelongsToBucket(ia, bucket)`**: `ia.taxType === bucket`. The engine sets `taxType` to one of the 4 bucket names (`preTax`/`taxFree`/`hsa`/`afterTax`) during router setup — no mapping needed.
- **`safeDivide(n, d)`**: Returns 0 when divisor is 0. Guards all `proRateFraction` and `rateCeilingScale` divisions.

**Layer 2 — Renderer** (two functions, fixed behavior)

- **`renderLineItem(item, idx, nested)`**: Renders one `TooltipLineItem` — label + tax suffix + amount + % + match sub-items + children. Recursive for `sub[]`.
- **`renderTooltip(data)`**: The single render function. Renders sections in a hardcoded order:
  1. Header (bold)
  2. Meta (gray — year, return rate)
  3. Meta2 (gray — BoY → EoY)
  4. Override note (emerald)
  5. Items (core content via `renderLineItem`)
  6. Total (bold, border-top, optional match)
  7. Tax split (Trad/Roth)
  8. Growth (blue/red)
  9. Contributions (green)
  10. Withdrawals (red, optional tax cost)
  11. Year change (total + change + breakdown)
  12. Rate ceiling (amber)
  13. Routing note (gray)
  14. Budget (gray, border-top)
  15. IRS limit (with maxed indicator)
  16. Pro-rate (months, annual → pro-rated)
  17. Balance / Legend

The renderer never decides _what_ data to show — only _how_ to render what's present. Every section is `{d.field && <render it>}`.

**Layer 3 — Call sites** (~23 locations)

Each builds a `TooltipData` object from engine output and passes it to `renderTooltip()`. Call sites provide data only — no CSS classes, no ordering decisions, no conditional rendering logic.

#### Balance-Change Derivation (critical pattern)

All balance tooltips derive contributions and withdrawals from actual balance changes instead of relying on engine routing fields:

```
inflow  = currentBalance - previousBalance - growth   (accumulation)
outflow = previousBalance + growth - currentBalance    (decumulation)
```

**Why**: The engine tracks `ia.contribution` per individual account, but the spec-to-account routing can produce zeroes when matching fails. Deriving from balance change is mathematically equivalent and robust.

**Where**: All 4 balance tooltip variants (accum by-tax-type, accum by-account, decum by-account, decum by-tax-type).

**First-year fallback**: When there's no previous projection year (`prevIa` is undefined), balance-change derivation would treat the entire starting balance as a "contribution". For year 0, fall back to the engine's tracked fields: `inflow = ia.contribution + ia.employerMatch`. For decumulation first year (no prev), outflow defaults to 0.

**Rule**: Balance tooltips use `balance - prevBalance - growth` when a previous year exists, and `ia.contribution + ia.employerMatch` when it doesn't. Never use `prevBal = 0` as a default — that's the bug that caused contributions to show as hundreds of thousands.

#### Data Sources by Tooltip Type

| Tooltip type                       | Primary source                                   | What it reads                                                           |
| ---------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| Contribution                       | `yr.slots[]` + `contribSpecs[]`                  | Per-category amounts, spec-level person/tax breakdown                   |
| Balance                            | `yr.individualAccountBalances[]`                 | Per-account balance + growth; contributions derived from balance change |
| Withdrawal                         | `dyr.slots[]` + `yr.individualAccountBalances[]` | Per-category withdrawal amounts, per-account balances                   |
| Info (age, salary, rate, warnings) | Scalar year fields                               | `yr.age`, `yr.projectedSalary`, warnings array                          |

**Important**: Balance tooltips enumerate accounts from `yr.individualAccountBalances` (engine output), NOT `accountBreakdown` (snapshot-only). The snapshot doesn't include accounts created by contribution specs.

#### Tax Label Rules

Automatic via `itemTaxType()` — no call-site logic needed:

- 401k, 403b, IRA → always `(Roth)` or `(Trad)` based on `taxType` field
- HSA, Brokerage → no suffix
- Applies to every `TooltipLineItem` in every tooltip type (balance, contribution, withdrawal)

#### Pro-Rate Rules

Year 0 (partial year) contributions are pro-rated: `firstYearFraction = (12 - asOfDate.getMonth()) / 12`. Both engine code paths (`useRealContribs` and `routeFromSpecs`) apply `* proRate`. The Rate column divides by pro-rated salary (`projectedSalary * proRateFraction`) so rates stay consistent with full-year equivalents.

#### Regression Traps

These have broken before during development — check during any migration:

| Trap                                  | Root cause                                                                                    | Prevention                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Balance contributions show as $0      | Used `ia.contribution` (engine routing field that can be 0)                                   | Use balance-change derivation, never `ia.contribution`                                                                       |
| Balance tooltips missing accounts     | Used `accountBreakdown` (snapshot-only, excludes spec-created accounts)                       | Use `yr.individualAccountBalances`                                                                                           |
| Pro-rate not applying                 | Engine has two code paths; only one was fixed                                                 | Both `useRealContribs` and `routeFromSpecs` paths must multiply by `proRate`                                                 |
| Rate artificially low in year 0       | Pro-rated contributions / full annual salary                                                  | Divide by `projectedSalary * proRateFraction`                                                                                |
| Total in/out missing HSA/Brokerage    | Old `taxSplit` only had Traditional/Roth                                                      | Enumerate from `yr.slots[]` to capture all types                                                                             |
| Tax labels missing on balance items   | Call site forgot `taxType: itemTaxType(...)`                                                  | Every 401k/403b/IRA item must pass through `itemTaxType()`                                                                   |
| Contributions routed to wrong account | Engine `specToAccount` key didn't include tax treatment — same person+category specs collided | `specKey` must include `taxTreatment` (e.g., `name::personId::taxTreatment`)                                                 |
| Hardcoded category/bucket if-chains   | New category added but not in every if-chain — silently dropped                               | Use data-driven helpers (`colKeyParts`, `bucketSlotMap`, `catDisplayLabel`). Never write `if (cat === '...')` in call sites. |
| Division by zero (Infinity%)          | `proRateFraction` or `rateCeilingScale` is 0                                                  | Always use `safeDivide()` and guard with `> 0` checks before dividing                                                        |

#### Visual Validation Checklist

| Step | What to hover                          | Expected                                                    |
| ---- | -------------------------------------- | ----------------------------------------------------------- |
| 1    | Year 0 contribution cell               | Pro-rate line with `X/12 mo`, non-zero amounts              |
| 2    | Traditional balance (by tax-type view) | Account names with `(Trad)`, non-zero contrib sub-items     |
| 3    | Roth balance (by tax-type view)        | Account names with `(Roth)`, contrib sub-items              |
| 4    | Any 401k column (by account view)      | Per-account breakdown matching tax-type totals              |
| 5    | Total In column                        | All contributing types present (Trad, Roth, HSA, Brokerage) |
| 6    | Rate column on year 0                  | Rate matches full-year equivalent (not artificially low)    |
| 7    | Decum balance cell                     | Withdrawal/growth info, per-account breakdown               |
| 8    | Total balance column                   | All 4 tax buckets with percentages                          |

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

| Component               | Import                                  | Variants/Props                                                                      | Use                                             |
| ----------------------- | --------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Button**              | `@/components/ui/button`                | `variant`: primary, secondary, ghost, danger. `size`: xs, sm, md. `icon`: ReactNode | All action buttons                              |
| **Badge**               | `@/components/ui/badge`                 | `color`: gray, blue, green, red, amber, purple, indigo                              | Status/category labels                          |
| **AccountBadge**        | `@/components/ui/account-badge`         | `type`: account category string                                                     | Account type labels (derives color from config) |
| **Card**                | `@/components/ui/card`                  | `title`, `subtitle`, `headerRight`, `collapsible`, `defaultOpen`                    | Content containers                              |
| **Metric**              | `@/components/ui/card`                  | `value`, `label`, `trend`                                                           | KPI display inside cards                        |
| **ProgressBar**         | `@/components/ui/card`                  | `value` (0-1), `label`, `color`, `tooltip`                                          | Progress indicators                             |
| **Skeleton**            | `@/components/ui/skeleton`              | `className` (default: `h-4 w-full`)                                                 | Base loading placeholder                        |
| **SkeletonChart**       | `@/components/ui/skeleton`              | `height` (default: 250)                                                             | Chart loading placeholder                       |
| **SkeletonTable**       | `@/components/ui/skeleton`              | `rows` (default: 5), `columns` (default: 4)                                         | Table loading placeholder                       |
| **EmptyState**          | `@/components/ui/empty-state`           | `message`, `hint`, `icon`, `action`, `link`                                         | Empty page/section placeholder                  |
| **FormError**           | `@/components/ui/form-error`            | `error`, `message`, `prefix`                                                        | Inline field-level error (xs red text)          |
| **FormErrorBlock**      | `@/components/ui/form-error`            | `error`, `message`, `prefix`                                                        | Section-level error (alert box)                 |
| **Tooltip**             | `@/components/ui/tooltip`               | `content`, `lines`, `side`, `align`, `maxWidth`                                     | Hover information                               |
| **HelpTip**             | `@/components/ui/help-tip`              | `text`, `lines`, `learnMoreHref`                                                    | Question-mark icon with help tooltip            |
| **Toggle**              | `@/components/ui/toggle`                | `checked`, `onChange`, `label`, `size`: xs/sm                                       | On/off switch                                   |
| **SlidePanel**          | `@/components/ui/slide-panel`           | `open`, `onClose`, `title`                                                          | Right-sliding overlay panel                     |
| **InlineEdit**          | `@/components/ui/inline-edit`           | `value`, `onSave`, `formatDisplay`, `parseInput`, `type`                            | Click-to-edit text field                        |
| **InlineSelect**        | `@/components/ui/inline-edit`           | `value`, `options`, `onSave`                                                        | Click-to-edit dropdown                          |
| **DataTable**           | `@/components/ui/data-table`            | `columns`, `data`, `isLoading`, `onDelete`, `compact`                               | Sortable CRUD table                             |
| **PageHeader**          | `@/components/ui/page-header`           | `title`, `subtitle`, `children` (actions)                                           | Page title bar                                  |
| **ThemeToggle**         | `@/components/ui/theme-toggle`          | `compact`                                                                           | Light/dark/system picker                        |
| **confirm()**           | `@/components/ui/confirm-dialog`        | Returns `Promise<boolean>`                                                          | Imperative confirmation dialog                  |
| **promptText()**        | `@/components/ui/confirm-dialog`        | Returns `Promise<string \| null>`                                                   | Imperative text input dialog                    |
| **useToasts()**         | `@/components/ui/toast`                 | `addToast({ variant, message })`                                                    | Toast notifications                             |
| **ErrorBoundary**       | `@/components/ui/error-boundary`        | `fallback`                                                                          | Catch render errors                             |
| **ContribPeriodToggle** | `@/components/ui/contrib-period-toggle` | `value`, `onChange`                                                                 | Annual/monthly/paycheck toggle                  |
| **ScenarioValue**       | `@/components/ui/scenario-indicator`    | `entity`, `recordId`, `field`                                                       | Scenario override indicator                     |

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
