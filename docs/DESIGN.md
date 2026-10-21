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

| Phase                                 | Status          | Notes                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phase 1: Skeleton + Data Model + Seed | **COMPLETE**    | Schema (<!-- AUTO-GEN:migrations -->12<!-- /AUTO-GEN --> squashed baseline per release with dialect-specific PG/SQLite SQL, <!-- AUTO-GEN:tables -->81<!-- /AUTO-GEN -->+ tables), seed script, <!-- AUTO-GEN:settingsComponents -->26<!-- /AUTO-GEN --> settings tabs                                                                                                                                 |
| Phase 2: Calculation Engine           | **COMPLETE**    | <!-- AUTO-GEN:calculators -->19<!-- /AUTO-GEN --> calculators + modular engine (<!-- AUTO-GEN:engineModules -->27<!-- /AUTO-GEN --> modules)                                                                                                                                                                                                                                                           |
| Phase 3: Dashboard + Core Pages       | **COMPLETE**    | Dashboard (<!-- AUTO-GEN:dashboardCards -->20<!-- /AUTO-GEN --> dashboard card components), Paycheck, Budget, Portfolio                                                                                                                                                                                                                                                                                |
| Phase 4: Budget API Integration       | **COMPLETE**    | YNAB + Actual Budget clients, sync router, cache, factory. Cash integration (API owns cash when active), budget 2-way sync, savings category sync, portfolio auto-push on snapshot, asset pull on sync, account mappings, expense YoY comparison, API category picker UI.                                                                                                                              |
| Phase 5: Remaining Pages              | **COMPLETE**    | Performance, Net Worth, Retirement (+ 3 methodology sub-pages), Mortgage, Savings, Historical, Settings, Tools                                                                                                                                                                                                                                                                                         |
| Phase 6: Polish + Deployment          | **IN PROGRESS** | UI review complete: shared primitives (Button, Badge, Skeleton, EmptyState), projection decomposition (8.3K→1.8K lines), responsive grids, Button adoption, Skeleton adoption, color standardization, design system docs. Docker/SWAG/monitoring/CI are built and operational (see § Deployment below) — remaining work is human ops cutover tasks (DNS, vault secrets, Semaphore template), not code. |

### What's Built

- **<!-- AUTO-GEN:pages -->36<!-- /AUTO-GEN --> pages:** Dashboard, Paycheck, Budget, Portfolio, Performance, Net Worth, Retirement (+ Methodology, Accumulation Methodology, Decumulation Methodology), Mortgage, Assets, Savings, Historical, Settings, Tools (ESPP calculator, Relocation calculator), Contributions, Data Browser, Expenses, Help, House, Liabilities, Versions, Brokerage, Benchmarks (+ Methodology; /analytics redirects here)
- **<!-- AUTO-GEN:calculators -->19<!-- /AUTO-GEN --> calculators:** paycheck, tax, budget, contribution, mortgage, net-worth, savings, savings-capacity, efund, brokerage-goals, monte-carlo, random (distributions), relocation, coast-fire, social-security, simple-tax-mode (Simple tax mode: retirement money as one pot), plan-outcome (assessPlan — the one plan judge)
- **Modular engine:** `lib/calculators/engine/` — <!-- AUTO-GEN:engineModules -->27<!-- /AUTO-GEN --> modules (projection orchestrator, year handlers, contribution routing, withdrawal routing, tax estimation, override resolution, balance utils/deduction, individual account tracking, growth application, RMD enforcement, post-withdrawal optimizer, spending strategies: Guyton-Klinger, Vanguard Dynamic, Constant Percentage, Endowment, Spending Decline, Forgo Inflation, RMD Spending)
- **<!-- AUTO-GEN:primaryRouters -->26<!-- /AUTO-GEN --> primary tRPC routers + <!-- AUTO-GEN:settingsSubRouters -->4<!-- /AUTO-GEN --> settings sub-routers** + shared helpers
- **<!-- AUTO-GEN:settingsComponents -->26<!-- /AUTO-GEN --> settings components**
- **<!-- AUTO-GEN:dashboardCards -->20<!-- /AUTO-GEN --> dashboard card components**

---

## Major Refactors

Two foundational refactors shaped the current architecture. All new code must follow the patterns they established.

### Refactor 1: Data-Driven Architecture (Overall Refactor)

**Intent:** Eliminate all hardcoded account type knowledge from the codebase. Before this refactor, 150+ locations across 25+ files contained `if (category === '401k')` checks, duplicated label maps, hardcoded `['401k', '403b', 'hsa', 'ira', 'brokerage']` arrays, literal type unions, and heuristic matchers.

**Result:** All account-type behavior is now declared in a single config record (`ACCOUNT_TYPE_CONFIG` in `src/lib/config/account-types.ts`). The codebase is generic infrastructure that reads config properties. Adding a new account type requires adding one config entry — zero code changes elsewhere.

See RULES.md § Data-Driven Architecture for the full rules. The refactoring established config-driven behavior via `ACCOUNT_TYPE_CONFIG`.

### Refactor 2: Engine Decomposition (Engine Refactor)

**Intent:** The retirement engine grew to ~3100 lines in a single file with an implicit ordering contract between 7 sequential post-withdrawal operations. The refactor extracted each concern into a focused module while preserving identical behavior.

**Result:** `lib/calculators/engine/` now contains <!-- AUTO-GEN:engineModules -->27<!-- /AUTO-GEN --> modules with explicit interfaces. Each module has a single responsibility and clear inputs/outputs. The orchestrator (`projection.ts`) calls modules in a defined pipeline order. The public API surface is minimal (`calculateProjection()` + `calculateContributionEngine()` + tax helpers).

See RULES.md § Engine Modularity for the full module list (<!-- AUTO-GEN:engineModules -->27<!-- /AUTO-GEN --> modules) and rules. The orchestrator calls modules in an explicit pipeline order.

---

## Project Structure

Run `ls src/lib/ src/components/ src/server/routers/` for the live layout.
Key concept → directory map:

| Concept                 | Directory                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Calculators (pure)      | `src/lib/calculators/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Engine modules          | `src/lib/calculators/engine/` (<!-- AUTO-GEN:engineModules -->27<!-- /AUTO-GEN --> modules)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Calculator I/O types    | `src/lib/calculators/types.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Config tables (declare) | `src/lib/config/` (account types, tax, RMD, IRMAA, ACA)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| DB schema               | `src/lib/db/schema.ts` (<!-- AUTO-GEN:tables -->81<!-- /AUTO-GEN -->+ tables)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| tRPC routers            | `src/server/routers/` (<!-- AUTO-GEN:primaryRouters -->26<!-- /AUTO-GEN --> primary + <!-- AUTO-GEN:settingsSubRouters -->4<!-- /AUTO-GEN --> settings sub-routers)                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Auth + tRPC middleware  | `src/server/auth.ts`, `src/server/trpc.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Pages (App Router)      | `src/app/(dashboard)/` (<!-- AUTO-GEN:pages -->36<!-- /AUTO-GEN --> pages)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Shared UI primitives    | `src/components/ui/` (<!-- AUTO-GEN:uiComponents -->31<!-- /AUTO-GEN --> components)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Domain components       | `src/components/{paycheck,budget,savings,networth,performance,mortgage,settings}/` — paycheck (<!-- AUTO-GEN:paycheckComponents -->20<!-- /AUTO-GEN -->), budget (<!-- AUTO-GEN:budgetComponents -->19<!-- /AUTO-GEN -->), savings (<!-- AUTO-GEN:savingsComponents -->23<!-- /AUTO-GEN -->), networth (<!-- AUTO-GEN:networthComponents -->9<!-- /AUTO-GEN -->), performance (<!-- AUTO-GEN:performanceComponents -->14<!-- /AUTO-GEN -->), mortgage (<!-- AUTO-GEN:mortgageComponents -->8<!-- /AUTO-GEN -->), settings (<!-- AUTO-GEN:settingsComponents -->26<!-- /AUTO-GEN -->) |
| Dashboard cards         | `src/components/cards/` (<!-- AUTO-GEN:dashboardCards -->20<!-- /AUTO-GEN --> cards)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Budget API clients      | `src/lib/budget-api/` (YNAB + Actual)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Migrations              | `drizzle/` + `drizzle-sqlite/` (<!-- AUTO-GEN:migrations -->12<!-- /AUTO-GEN --> squashed baseline per release; PG in `drizzle/`, SQLite in `drizzle-sqlite/`)                                                                                                                                                                                                                                                                                                                                                                                                                       |
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

| Authentik Group              | Permission            | Grants                                                                                                                                         |
| ---------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `ledgr-admin`                | (admin role)          | Full access to everything                                                                                                                      |
| `ledgr-scenario`             | `scenario`            | Create/edit/delete Plans (sets of profiles)                                                                                                    |
| `ledgr-contribution-profile` | `contributionProfile` | Contribution and Salary Profiles — every Salary Profile entry field (incl. W-4, pay schedule, where the bonus goes) — and making either active |
| `ledgr-version`              | `version`             | Create, restore, import and delete saved versions (backups)                                                                                    |
| `ledgr-portfolio`            | `portfolio`           | Create/delete portfolio snapshots                                                                                                              |
| `ledgr-performance`          | `performance`         | Manage performance accounts + account performance                                                                                              |
| `ledgr-budget`               | `budget`              | Edit budget items, columns, profiles                                                                                                           |
| `ledgr-savings`              | `savings`             | Manage savings goals, transactions, allocations                                                                                                |
| `ledgr-brokerage`            | `brokerage`           | Manage brokerage goals + planned transactions                                                                                                  |
| `ledgr-sync`                 | `sync`                | Trigger budget API sync operations                                                                                                             |

Route-level protection via Next.js middleware on `/(dashboard)` routes. Permission enforcement at tRPC procedure level. UI gating via `UserContext` (`useUser()`, `hasPermission()`, `isAdmin()`).

### Server/Client Component Boundary

| Layer                 | Type                    | Examples                   |
| --------------------- | ----------------------- | -------------------------- |
| Page shells           | Server (`page.tsx`)     | Data prefetching, layout   |
| Dashboard layout      | Server (`layout.tsx`)   | Auth wrapper, sidebar      |
| Charts, tables, forms | Client (`'use client'`) | All interactive components |

### Privacy Mode

An eye button in the sidebar hides every dollar amount (Actual Budget's "hide" mode). The choice is stored in the `ledgr-privacy` cookie, so the server sees it.

- **Masking.** `formatCurrency` / `compactCurrency` return `maskedAmount()` while a module-level flag is on: `$` plus 3–8 (compact: 2–3) squiggle glyphs. Length and glyphs come from a hash of the value and a per-page-load random salt — stable across re-renders, different after a reload, and never derived from the amount's digits. `maskAmountsInText()` does the same for amounts inside pre-built sentences (engine warnings, report narratives); the engine itself stays pure.
- **Never set the flag on the server.** The format module is shared by every request there. `PrivacyProvider` (`lib/context/privacy-context.tsx`) sets it during the first browser render, from the cookie the dashboard layout read.
- **No amounts in server HTML.** Pages that prefetch data for hydration use `prefetchForPage()` (`server/helpers/server-trpc.ts`), which skips the prefetch when the cookie is set, so the first HTML has loading states instead of amounts. New prefetching pages must use it, not `createServerHelpers` directly.
- **Toggling remounts the page.** `DashboardShell` keys its content on the privacy state so every formatter re-runs; the React Query cache survives (no refetch) but unsaved inline-edit state on the open page resets.
- **The squiggle font.** `maskedAmount()` emits Private Use Area characters U+E000–E007, drawn by `src/app/fonts/ledgr-redacted.woff2` (generated by `scripts/gen-redacted-font.py`; family "Ledgr Redacted"). `globals.css` appends that family to Tailwind's `--default-font-family` / `--default-mono-font-family` and the `.font-sans` / `.font-mono` utilities, so it only draws those code points. Not next/font's `fallback` option (it drops the size-adjusted Plex fallback) and not extra faces on the Plex family (Chrome skips faces with different weight descriptors).
- **Deliberately not masked:** percentages, counts, dates, editable inputs, growth ratios such as the Retirement card's Growth benchmark (`data-privacy-visible`), exports, and the `+` / `-` direction signs components print next to an amount.
- **Guard.** `tests/e2e/privacy-mode.spec.ts` visits every route with the cookie set and fails on any rendered `$<digit>`.

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
- **Contrast floor (WCAG 1.4.11):** a data-carrying chart stroke or its legend swatch must clear 3:1 against the card background (and against any fill it's drawn over) in **both** themes. A single `CHART_COLORS` hex often can't — see `chartLinePalette(dark)` in `colors.ts` for the theme-aware escape hatch (mirrors `trajectoryChartPalette`). Decorative reference/zero lines are exempt.
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

#### Sub-accounts and SimpleFIN links

A sub-account is a snapshot row's identity — tracked account + tax type + kind (`subType`) + owner — built by `snapshotAccountKey()` (`lib/pure/portfolio.ts`). There is no sub-account table: sub-accounts exist only as snapshot rows, and the key is how a row is recognised across snapshots (e.g. carrying forward "inactive"). The owner is part of it because a joint account holds each person's money separately (two people's Roth rows in one joint IRA are two sub-accounts). The free-text `label` is display-only and not part of it.

Institutions report sub-accounts as separate accounts (Vanguard: one Roth IRA, Traditional IRA and Rollover IRA per person). A SimpleFIN account therefore links to a tracked account and, optionally, one of its sub-accounts (`simplefin_accounts.linked_sub_key`; null = the whole account, e.g. a workplace plan that reports every tax bucket as one account). Links are suggested from institution + account kind (`lib/config/simplefin-account-kinds.ts`) + balance closeness, assigned to minimise the total balance gap, never taking an already-linked sub-account, and only applied when the household confirms. A link whose sub-account leaves the latest snapshot is kept, flagged, and counts for the whole account meanwhile.

#### SimpleFIN investment data

- **Precision.** Money is `decimal(14,2)` everywhere, as elsewhere in Ledgr. Share counts and per-share figures (`holding_observations.shares`, `avg_cost_per_share`) are `decimal(20,8)`: funds report fractional shares to 3–6 places and a per-share cost to more, and shares × price must reproduce the institution's value to the cent. Never round shares to money precision.
- **Which accounts count.** A SimpleFIN account feeds its tracked account only when it's linked _and_ checked (`countsAsFeed` in `lib/pure/simplefin-feeds.ts`; SQL form `countedFeed`). An unchecked account keeps its link but is ignored by every total, comparison, fill and check; its tracked account goes by its manual snapshot balance. HSA card-spending redaction still follows the link.
- **Comparing live with a snapshot** needs the live balance to cover the whole account the way the snapshot does (`liveCoversAccount`): every part linked (or a whole-account feed), and no feed whose money sits outside a part.
- **Fill from SimpleFIN** (snapshots, Performance, Basis) is suggest-then-save. What a saved fill counted is an app-setting ledger per year (`server/helpers/fill-ledger.ts`): each row's baseline day plus the transaction ids counted and how (`kind`, conversion flag), so late, newly settled or reclassified rows are corrected rather than missed or double counted.
- **Fills work in totals, not transactions.** Each transaction counts as Ledgr's best guess (built-in rules, transfer matching); the household corrects a total in the form if it looks off, as from a statement. A deposit into an account whose Performance figures that year already record money rolled in from another tracked account (`recordedMoveDeposits`) is left out of a fill — counting it as a contribution too would count the money twice — and the account's note says how much. Splitting a deposit's employer / Roth parts is done on the period's totals, not per deposit.

### Snapshot Display (Grouped by Performance Account)

Portfolio snapshot history and the new snapshot form group rows by their parent `performanceAccount`, sorted by institution then account name. Each group shows a header with the account name (via `accountDisplayName()`) and a subtotal, with indented sub-rows beneath.

**Sub-row labels** follow two rules:

1. **Owner prefix**: Shown only when the performance account is joint (no individual owner) AND sub-rows have different `ownerPersonId` values. Example: "IRA (Vanguard)" has sub-rows "Alice — Roth" and "Bob — Roth".
2. **Sub-account type**: `label` (a free-text user override on the portfolio row) takes precedence over `subType` when set. Otherwise, when `subType` is present (e.g., "Rollover", "Employer Match", "ESPP"), it's shown with the tax type in parentheses. When both are null, the raw `accountType` is shown only if it differs from the parent performance account's type — otherwise just the tax type label.

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
return = gain_loss / (beginning_balance + (contributions + rollovers - distributions - fees) / 2)
```

`contributions` (total_contributions) already includes employer money for
every account type — do not add employer_contributions again. See
`computeReturn()` in `src/lib/pure/performance.ts`, the single canonical
implementation.

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

| Calculator       | Key Output                                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paycheck         | Per-period breakdown, year schedule (SS cap transition), bonus estimate                                                                                                                                                                     |
| Tax              | Effective/marginal rates, total liability                                                                                                                                                                                                   |
| Budget           | Tier totals, essential/discretionary split                                                                                                                                                                                                  |
| Contribution     | Utilization %, savings rate vs 25% target, "money left on table"                                                                                                                                                                            |
| Mortgage         | Amortization schedule, payoff projection, interest savings                                                                                                                                                                                  |
| Engine (modular) | Unified accumulation + distribution projection with bracket-filling withdrawals, RMDs, Roth conversions, SS tax torpedo, LTCG brackets, Guyton-Klinger guardrails, IRMAA/ACA awareness                                                      |
| Net Worth        | Wealth Score, FI progress, tax-bucket allocation                                                                                                                                                                                            |
| Milestones       | `lib/pure/milestones.ts` `evaluateMilestones()` — every Money Guy / Bogleheads / Fidelity rule and custom goal judged once (status, reached year from history, expected year from the projection); thresholds in `lib/config/milestones.ts` |
| Savings          | Months of coverage, goal projections                                                                                                                                                                                                        |
| E-Fund           | Essential expense coverage months                                                                                                                                                                                                           |
| Brokerage Goals  | View enricher: maps engine projection to per-goal status (funded/shortfall/tax cost)                                                                                                                                                        |
| Monte Carlo      | 1,000+ trial simulation with asset class correlations, glide path allocations, configurable presets                                                                                                                                         |
| Random           | Distribution utilities (normal, log-normal) for Monte Carlo                                                                                                                                                                                 |
| Relocation       | Budget comparison, FI target/age impact, earliest safe relocation, large purchase modeling                                                                                                                                                  |

### Relocation Calculator

The relocation decision tool (`lib/calculators/relocation.ts`) compares two budget scenarios year-by-year:

- **Core**: Computes expense delta, savings rate impact, FI target under each scenario, FI age under each scenario, recommended portfolio before relocating, and earliest safe relocation age.
- **Year adjustments**: Override relocation expenses for specific years (phase-in, cost cuts). Client-side state, not persisted.
- **Contribution overrides**: Override the retirement contribution rate (% of salary; Portfolio savings come on top) for specific years. Sticky forward — each applies until the next override.
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

The unified engine (`lib/calculators/engine/`) is decomposed into 24 focused modules (plus `projection-year-handlers/`, its own sub-decomposition of the per-year loop) with a clean public API exported from `engine/index.ts`. The engine was originally a single ~3100-line file; the engine refactor extracted each concern into its own module while preserving identical behavior.

**Public API** (from `engine/index.ts`):

- `calculateProjection()` — Full accumulation + decumulation projection
- `calculateContributionEngine()` — Contribution routing only (used by paycheck/contribution pages)
- Tax estimation helpers

**Module responsibilities:**

| Module                           | Responsibility                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `projection.ts`                  | Orchestrator — accumulation loop, decumulation loop, phase transition                                  |
| `contribution-routing.ts`        | Per-account contribution allocation, IRS limit enforcement, overflow to brokerage, employer match      |
| `withdrawal-routing.ts`          | Bracket-filling, waterfall, and percentage withdrawal modes                                            |
| `withdrawal-cost-ranking.ts`     | Cost-aware ranking of post-bracket-cap sources (Roth/brokerage/HSA) by real marginal rate (v0.7.9 R40) |
| `tax-estimation.ts`              | SS torpedo convergence (3-tier, 2-iteration), effective tax rate gross-up                              |
| `override-resolution.ts`         | Sticky-forward per-year config resolution                                                              |
| `balance-utils.ts`               | Balance cloning, type conversion helpers                                                               |
| `balance-deduction.ts`           | Withdrawal deduction, clamping, depletion tracking                                                     |
| `individual-account-tracking.ts` | Per-account bookkeeping (contributions, growth, withdrawals)                                           |
| `growth-application.ts`          | Return rate application on all balance structures                                                      |
| `rmd-enforcement.ts`             | IRS Uniform Lifetime Table lookup, forced Traditional distributions                                    |
| `rmd-smoothing.ts`               | Proactive Roth-conversion sizing to shrink a future forced RMD toward stated need (v0.7.9 R47)         |
| `qcd.ts`                         | Qualified Charitable Distribution amounts (IRC §408(d)(8), age 70+, not capped by RMD size)            |
| `post-withdrawal-optimizer.ts`   | Roth conversions, IRMAA awareness, ACA subsidy awareness                                               |
| `guyton-klinger.ts`              | Dynamic spending guardrails (upper/lower rails, prosperity rule)                                       |

The engine handles both phases in a single pass:

1. **Accumulation** (current age → retirement): per-account contribution routing (waterfall or percentage mode), IRS limit enforcement with overflow to brokerage, employer match, salary growth with cap, tax splits (Roth/Traditional)
2. **Distribution** (retirement → end): tax-optimal bracket-filling withdrawals by default. Three routing modes:
   - **Bracket filling** (default): fill traditional withdrawals up to a target marginal bracket cap, then rank the remainder (Roth/brokerage/HSA) by real marginal cost for that year — free basis/0%-LTCG room first, then whichever of Roth growth or brokerage LTCG (NIIT-aware above its MAGI threshold) is genuinely cheaper, HSA competing on the same real rate rather than an assumed-worst fixed position (`withdrawal-cost-ranking.ts`, v0.7.9 R40 — replaces the old fixed Roth→brokerage→HSA order, which is still what waterfall/percentage modes use). Requires `rothBracketTarget` + tax brackets; falls back to waterfall if missing.
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

**Retirement scope and the plan judge (v0.8.11).** Every year row carries two balances from one helper (`scopedBalances`, `balance-utils.ts`): `retirementBalance` — the aggregate minus Portfolio-parented accounts (`computeNonRetirementExclusion`, the same exclusion routing uses) — and `allAccountsBalance` (net-worth views only, lint-guarded). Depletion is retirement money running out. Whether a plan works is decided once, by `assessPlan` (`lib/calculators/plan-outcome.ts`): the first retirement year with material unmet spending (the engine's `unmetNeedMaterial`, floor `shortfallMaterialityFloor`) or with retirement money gone while later years still need withdrawals, with a reason (`depleted` / `penaltyGap` / `shortfall`). Simulation trials, Coast FIRE, the optimizers, tax optimization, relocation, stress tests and the report all read it. Routing guarantees that make the verdict meaningful: bracket filling draws Traditional above the target once Roth/brokerage/HSA are gone; percentage mode places an emptied or capped account's share on the others; the gross-up funds what routing actually delivers and prices NIIT; penalty-locked categories are capped at what their tracked accounts can give (`reachableByCategory`). The full contract is RULES.md § Account Categories.

**Tax-year resolution (R43):** every tax-figure consumer (the projection engine, the paycheck calculator, `savings.ts`) resolves its year through one function, `resolveTaxParams()` (`lib/config/tax-params.ts`), instead of each maintaining its own `WHERE tax_year = …` query. It picks a year — `tax_params` is an optional per-year vintage marker, not a value store; the existing `contribution_limits`/`tax_brackets`/`ltcg_brackets`/`irmaa_brackets`/`fpl_by_household` tables remain the only value store — and returns that year's slices in the shapes each engine module already consumed. A retirement profile can pin its resolved year via `retirement_profiles.tax_params_year` (NULL = track the latest enacted year, the default for every profile); re-opening a pinned profile reproduces its numbers instead of silently re-pricing when a newer tax year is seeded. The pin is reachable via `retirement.retirementProfiles.update`'s `taxParamsYear` field; there is no dedicated UI control for it yet (deliberately deferred, same as R43's test-fixture-migration scope-down — real value, separate follow-up). Also as of R43: `irmaa_brackets` is now actually read by the engine (previously the table and its Settings editor existed but nothing consumed them), and `fpl_by_household` gives the ACA subsidy cliff a DB home for the first time.

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

## Milestones

One judging path for financial rules: `evaluateMilestones(input)` (`lib/pure/milestones.ts`) reads a `MilestoneInput` built by `buildMilestoneInput()` (`lib/pure/milestone-input.ts`) from what the app already computes, and returns one `MilestoneResult` per milestone (status `reached` / `onTrack` / `behind` / `unknown`, headline, reached year, expected year, next step). Consumers never judge a rule themselves:

- **Milestones page** (`/milestones`) — everything, by group, plus the FOO ladder, the timeline and "next up".
- **Financial Checkup** (dashboard) — the `CHECKUP_MILESTONES` subset as traffic lights (its savings-rate row is the household's switchable display rate).
- **Retirement card** — Fidelity readiness uses the same checkpoint table and `incomeMultipleTarget()`.

Inputs: year-level history from `milestones.computeInputs` (via `buildYearEndHistory()`), the profile-aware contribution / savings / mortgage summaries, linked holdings (Bogleheads rows), and the dashboard projection (`useDashboardProjection()` — the same engine input as the Retirement card, so one cache entry). Reached dates use finalized years (and the current year for balances); expected dates scan the projection with today's cash held flat, growing today's-dollar targets (FI number, "today's dollars" goals) with inflation since the projection is nominal. The household's own goals and checklist live in `app_settings` (`milestone_custom_goals`, `milestone_checklist`), validated on write by the generic settings upsert. Where two sources disagree, the household picks one and every surface follows it: `milestone_checkpoint_source` (Money Guy liquid-investment checkpoints vs Fidelity retirement-savings checkpoints) drives the Milestones page and the Retirement card's Readiness; `milestone_savings_target_source` picks Money Guy's 25% (Retirement + Portfolio) or r/personalfinance's 15% (Retirement only) for the savings-rate milestone (FOO steps stay Money Guy's). r/personalfinance also adds mega backdoor Roth room (IRS total-additions limit `401k_total_additions_limit`, config `irsLimitKeys.totalAdditions`), near-term brokerage goals, and per-fund expense ratios. FOO step 6 counts every account in the Retirement parent category (employee money against each IRS limit), and is also met by a Retirement-only savings rate of 25% (judged to whole percents) — that rate counts the employer match below the household's high-income threshold and leaves it out above it, like the 25% savings-rate milestone; step 5 is the config's `fooStep: 5` types (IRA, HSA).

## Current glide path (Benchmarks)

The household can set a **current glide path** — its target mix by age for what it holds today — on Benchmarks ("Your mix vs your target"). It's separate from the retirement simulation's glide path (`glide_path_allocations`, which the engine and Monte Carlo read), so the real portfolio can be held more conservatively than the plan projects with. Stored in `app_settings.current_glide_path`, validated on write (`currentGlidePathSchema`: each age's mix adds to 100%); `loadHoldingsOverview` interpolates it at the primary person's age when set and falls back to the simulation's glide path when not (`targetSource`). Benchmarks' mix vs target and Milestones' rebalancing both read that target. Allocation counts only SimpleFIN accounts linked to a Ledgr account; unlinked ones are listed as left out. Next to "What it costs", a stacked chart shows that glide path by age (asset-class colors from their fund categories) with Vanguard Target Retirement's stock share (`VANGUARD_TDF_STOCK_SHARE`, shifted to the household's retirement age) as a dashed line to compare with the top of the stock bands.

## Household annual income and tax

This year's income figures come from one model: `computeAnnualEarnings()` (`lib/pure/household-income.ts`), built from each person's paycheck result — salary plus the **resolved** bonus (the set bonus if there is one, else the formula), pre-tax money (pre-tax payroll contributions on regular checks and — for accounts set to `fromBonus` — on bonus checks, `annualContributionWithBonus`'s rule, plus pre-tax deductions) and FICA wages (gross less Section 125 deductions and payroll contributions to an account type with `payrollFicaExempt` — HSA — within its yearly cap: the IRS limit less employer money (`payrollFicaExemptCap`), one cap shared across a person's rows of the same account type (`shareFicaExemptCaps`), age at Dec 31 from `ficaCapContext`; only pre-tax rows count). The paycheck router returns it per person and as `householdIncome`; the annual tax, the Income card, Living Costs and MAGI all read it. A job's bonus can go to extra spending instead of the budget (Salary Profile entry `bonusDestination`): Living Costs then shows its take-home (`bonusSpendingNet`) as its own bar.

`calculateHouseholdTax()` figures the year's liability: federal on the combined income with one standard deduction; Social Security per person on FICA wages, capped at the wage base; Medicare per person; and the 0.9% Additional Medicare Tax on the household's combined Medicare wages above the filing status's **liability** threshold (`fica_medicare_surtax_liability_<status>`). Employers withhold it per employee above a separate **withholding** threshold (`fica_medicare_surtax_threshold`, IRC 3102(f)) — that row belongs to paycheck withholding only; the household tax uses it just to say how withheld and owed differ (Form 8959). Both are seeded reference rows, admin-editable. The NIIT thresholds, by contrast, stay in engine config: they're statutory, not indexed, and only the retirement engine reads them — don't "fix" one toward the other. The effective rate is federal ÷ wage AGI, the tax-return definition; FICA is its own line. Actual-YTD withholding is summed from the year schedule (`withheldThroughPeriod`), which charges full Social Security until the wage base — the per-check figure is the year's Social Security averaged over every check.

Roth IRA MAGI (`buildRothIraView`, `lib/pure/roth-ira.ts`) = wage AGI − HSA money paid outside payroll + taxable investment income (`lib/pure/investment-income.ts`: dividends and interest in taxable account types, this year so far plus last year's rest-of-year per feed, annualized where a feed's history is shorter; a tax year that hasn't started uses this year's estimate). Roth conversions are left out of both sides; the traditional IRA deduction isn't modelled. The verdict needs a safety margin below the phase-out start (default the range width, `roth_ira_direct_margin` setting). The detail lives on the Taxes page (Planning → Taxes: `TaxBreakdown` + `RothIraSection`); the dashboard's Household Income card stays light — two tax lines and one Roth IRA line (`RothIraLine`) linking there.

## Holding history

`holding_periods` / `holding_period_weights` store only **entered** (and, later, inferred) periods — funds and their weights (share of the account, not share counts) per account over dates. **Per part:** an account whose counted feeds are linked to parts (`simplefin_accounts.linked_sub_key` — e.g. a joint IRA with one feed per person and tax type) keeps one history per part (`holding_periods.sub_key` = `snapshotAccountKey`; `accountSplits` decides, sticky while part periods exist; part and whole-account feeds at once is a conflict shown to the household). Every other account — a 401(k) whose parts share one whole-account feed — keeps one whole-account history (`sub_key` null). A split account's parts are every part it has had in any snapshot plus its feeds' parts (`loadAccountPartHistory`); a stored period with no holder is orphaned (shown to move or delete, never counted). **Observed** periods are derived on read from `holding_observations`: `holdingsByAccountDay` groups each account's holdings by day, carrying each feed's latest holdings forward so an account fed by several feeds that report on different days reads as one holding; `deriveObservedPeriods` starts a new period when the set of funds changes or the data skips more than `HOLDING_PERIODS.observedMaxGapTradingDays` trading days, and leaves the last one open only while the feed still reports. Priority where they overlap: observed → entered → inferred (`periodOn`). The matched-mix benchmark (`lib/pure/matched-mix.ts`) prices weights with one index fund per composition bucket (`BUCKET_INDEX_PROXIES`): in the observed window the actual (drifting) weights on each month's first observed day, for entered periods their fixed weights (rebalanced monthly); accounts weighted by beginning-of-year balance; a split account's month is built per part (its observed month, else its entered period) and the parts combined by their snapshot shares (`partSharesOn`: latest snapshot on or before the month, the earliest before the first; a part not in it = 0) — when every part with money was observed that month, that is the account's pooled daily mix; a month counts only when every account is covered and the priced share reaches `HOLDINGS_MIN_COVERAGE`. The monthly level runs through the same `simulateIndex` as every benchmark (`matchedMixRun`).

## Recommendations

`/recommendations` (and the Checkup's "N recommendations →" link) lists what to do next, ranked. `lib/pure/recommendations.ts` gathers from results other engines already judged — each source is an adapter that only maps fields (`recommendationsFromMilestones`: Behind or alerting milestones with a next step, areas from `lib/config/recommendations.ts`). Urgency is the source's own (alert → now, behind → soon); dollars are the milestone's `impact`, set where the gap is computed. `rankRecommendations` orders by urgency, then yearly dollars, then configured order; one-time and yearly amounts are never compared. Both the page and the Checkup read `useRecommendations()`, which uses `useMilestones()` — its holdings and brokerage-goal rows are permission-gated inside the hook, so every caller judges the same set. Investment items are adapters too: Roth IRA and pro-rata (`recommendations-roth.ts` over `buildRothIraView`, date windows in config), cash drag and HSA cash (`recommendations-cash.ts` over `lib/pure/cash-positions.ts`), tax-loss harvesting and cheaper equivalent funds (`recommendations-funds.ts` over `lib/pure/fund-findings.ts`); `useInvestingFindings()` gathers the investing inputs behind the portfolio permission.

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

## Profiles and Plans

From the user's seat: each profile is its own world, and only the active one
counts. The header shows the active Salary, Contribution, Budget and
Retirement profile and the view mode; every page uses exactly those. A
**Plan** is a saved set of those four — applying it makes them the active
ones; changing any one picker leaves "None (unsaved mix)". The What-If tab is
the only sandbox, and it never writes the active profiles. Rules and
mechanics: RULES.md "Profiles and Plans" / "Profile Resolution".

What each kind holds:

- **Salary Profile** — one complete entry per job: salary, bonus terms, where
  the bonus goes (`bonusDestination`), pay schedule, W-4 elections,
  extra-paycheck routing, other pay (see
  `resolveCompensation`/`mergeSalaryProfileJobFields` in
  `server/helpers/salary.ts` and RULES.md's "The Salary Profile layer"). "How
  much do I earn" and "what withholding/schedule elections apply" are one axis
  — an accepted tradeoff. A job's employer name is fixed once created.
- **Contribution Profile** — contribution account values/methods/match,
  whether each payroll account is also taken from bonus checks (`fromBonus`),
  and deduction amounts. It never touches `jobs`.
- **Budget Profile** — budget items per column (spending level), optionally
  weighted by months; savings goal allocations (%/$) are a facet of it
  (`savings_goal_profile_allocations` is keyed to `budget_profile_id`), not a
  fifth kind.
- **Retirement Profile** — retirement assumptions (ages, inflation, strategy).

Resolution: page-local selection (profile managers, What-If) → active. Budget
columns are spending levels with no profiles of their own, and there is no
Plan tier.

---

## Pragmatic Deviations

Documented deviations from general architectural rules, kept for pragmatic reasons:

1. **Resolution helper lives in `helpers.ts`, not `override-resolution.ts`**: Profile resolution requires DB access. The engine layer (`lib/calculators/engine/`) is pure functions with no DB. Splitting into two layers adds complexity without proportional benefit at current scale. Revisit if override resolution logic grows beyond ~50 lines.

2. **Zod validation for a profile's active fields is manually defined, not derived from config**: `contribAccountActiveFieldsPatchSchema` / `deductionActiveFieldsSchema` / `salaryEntrySchema` are hand-written rather than derived from the Drizzle schema or `ACCOUNT_TYPE_CONFIG` — derivation adds abstraction with the risk of rejecting valid values if it has bugs, and the hand-written schemas are easy to audit at the current field count. Which fields a profile holds is still read from these schemas, never a hand-kept list (`lib/db/profile-fields.ts`). Revisit if the fields exceed ~25 or change often.

3. **Plans keep the internal name `scenarios`** (table, router, permission key `scenario`): renaming would be a migration plus an RBAC-data change for no user-facing gain. Everything user-facing says "Plan".

---

## Deployment (Phase 6 — Not Started)

| Concern          | Implementation                                                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dockerfile       | 3-stage build (deps → builder → runner), `node:24-alpine` pinned to digest, standalone output                                                                                     |
| Compose          | Hardened: `read_only`, `cap_drop: ALL`, `no-new-privileges`, `127.0.0.1` port binding, CPU+memory limits                                                                          |
| Proxy            | SWAG reverse proxy via `homelab.proxy.*` container labels                                                                                                                         |
| Health           | `GET /api/health` — simple probe (status + version). `GET /api/health/detailed` — authenticated (pool stats, budget API, sync timestamps)                                         |
| Security headers | CSP (no `unsafe-eval`), HSTS, X-Frame-Options DENY, Permissions-Policy                                                                                                            |
| Monitoring       | Structured JSON logging, Grafana dashboard, Discord alerting                                                                                                                      |
| Migrations       | `db-migrate.ts` compiled on its own with `tsc` (no `src/` imports), runs as `node db-migrate.js` in entrypoint; data-converting migrations: RULES.md "Data-converting migrations" |
| Secrets          | All in `vars/secrets.yaml`, rendered via Ansible `env.j2` template                                                                                                                |

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

**Status colors** — sourced from `STATUS_COLORS` in `lib/utils/colors.ts`
(one literal-Record lookup, not hardcoded per call site). Amber uses
`text-amber-800` rather than `-700` because `-700` fails WCAG AA 4.5:1
contrast on `bg-amber-100` (v0.5 expert-review M14) — this applies to
plain status text too, not just filled badges/alerts, so there is only
one canonical shade per color rather than a lighter "text-only" variant:

| Context      | Classes                                                            |
| ------------ | ------------------------------------------------------------------ |
| Error        | `text-red-700`, `bg-red-100 border-red-300`                        |
| Warning      | `text-amber-800`, `bg-amber-100 border-amber-300`                  |
| Success      | `text-green-700`, `bg-green-100 border-green-300`                  |
| Info/link    | `text-blue-700 hover:text-blue-800`, `bg-blue-100 border-blue-300` |
| Danger hover | `hover:text-red-700`                                               |

Consumers: `Badge`, `toast.tsx`, `scenario-indicator.tsx`'s
`ScenarioBanner`, `plan-health.tsx`'s `CalloutLine`.

### Component Catalog

Run `ls src/components/ui/` for the live list (<!-- AUTO-GEN:uiComponents -->31<!-- /AUTO-GEN --> components). Each
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
    <p className="text-sm text-red-600">Failed to load: {error.message}</p>
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
