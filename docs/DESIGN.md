# Ledgr — Design & Architecture

## Tech Stack

| Layer     | Technology                                    | Notes                                                |
| --------- | --------------------------------------------- | ---------------------------------------------------- |
| Framework | Next.js 16 (App Router), React 19, TypeScript | `pnpm`                                               |
| Styling   | Tailwind CSS 4 + design tokens                | Custom components in `src/components/ui/`            |
| Charts    | Recharts                                      | Loaded with `next/dynamic`                           |
| Database  | SQLite (default) or PostgreSQL                | `DATABASE_URL` picks the dialect                     |
| ORM       | Drizzle                                       | Decimals come back as strings; `toNumber()` converts |
| API       | tRPC 11 + Zod 4                               | End-to-end types and validation                      |
| Auth      | Auth.js (NextAuth v5) + OIDC (Authentik)      | Admin / viewer roles + permission add-ons            |
| Tests     | Vitest, Playwright                            | See `docs/TESTING.md`                                |
| Hosting   | Self-hosted Docker                            | Hardened compose behind a reverse proxy              |

## What's Built

- **<!-- AUTO-GEN:pages -->36<!-- /AUTO-GEN --> pages** — Dashboard, Paycheck, Budget, Savings, Portfolio, Performance, Brokerage, Benchmarks, Net Worth, Historical, Mortgage, Liabilities, Assets, Retirement (+ methodology pages), Tax Buckets, Taxes, Milestones, Recommendations, Profiles, Tools (ESPP, Relocation), Settings, Versions and more.
- **Calculators** in `lib/pure/<area>/` — paycheck, tax, budget, contribution, mortgage, net worth, savings, emergency fund, brokerage goals, Monte Carlo simulation, relocation, Coast FIRE, Social Security, Simple tax mode, the plan judge (`assessPlan`) and more.
- **The projection engine** — `lib/pure/engine/`, <!-- AUTO-GEN:engineModules -->33<!-- /AUTO-GEN --> modules; map in `engine/ARCHITECTURE.md`.
- **<!-- AUTO-GEN:primaryRouters -->27<!-- /AUTO-GEN --> primary tRPC routers + <!-- AUTO-GEN:settingsSubRouters -->5<!-- /AUTO-GEN --> settings sub-routers**, <!-- AUTO-GEN:tables -->84<!-- /AUTO-GEN -->+ tables, <!-- AUTO-GEN:migrations -->16<!-- /AUTO-GEN --> migrations (PG + SQLite).
- **Integrations** — YNAB and Actual Budget (two-way budget sync, cash, assets, savings categories), SimpleFIN (balances, holdings, transactions), Tiingo prices, SEC fund facts.

Two patterns shape everything (rules in RULES.md): account-type behavior is **declared in config** (`ACCOUNT_TYPE_CONFIG` — a new account type is meant to be one entry; see RULES.md § Known Gaps), and the engine is **one pure module per concern** behind an orchestrator.

## Financial Philosophy

Three communities shape the app's design:

**YNAB:** Give Every Dollar a Job. Embrace True Expenses (large infrequent costs broken into monthly savings). Roll With the Punches (multi-tier budgets adapt immediately). Age Your Money (income replacement fund). Integrates with YNAB API for transaction tracking — this app is the strategic layer on top.

**The Money Guy Show:** Financial Order of Operations. Money Guy's checkpoints by age (liquid investments as a multiple of gross income). 25% savings rate target. Tax-bucket diversification (Roth / Traditional / After-Tax / HSA) as a first-class feature.

**Bogleheads:** Keep it simple (account-level balances, not individual funds). Stay the course (show the full long-term history). Tax-efficient fund placement. Low costs.

---

## The #1 Design Principle: Adaptability

> Financial situations change, and this app must adapt.

This is the architectural foundation. Every data model, UI component, and calculation must be designed so that change is easy and expected.

1. **Nothing is hardcoded that could change.** Contribution limits, tax brackets, budget categories, savings buckets, account types — all configurable data, never constants in code.
2. **Entities are generic, not special-cased.** Contribution accounts are one generic system — adding a 529 plan is adding a row, not writing new code (the target; see RULES.md § Known Gaps).
3. **Budget profiles are fully user-created.** Not hard-wired scenarios.
4. **Savings buckets are user-defined.** Users can add, rename, archive, or remove goals.
5. **Retirement scenarios are fully composable.** Different withdrawal rates, target incomes, start years — all mix-and-match.
6. **The calculation engine is modular.** Each calculator takes inputs and returns outputs with no hidden dependencies.
7. **Job changes are a first-class event.** Old job gets an end date, new job starts. Historical data preserved.
8. **Year-over-year limits are versioned.** IRS limits, tax brackets — all keyed by year in the DB.

---

---

## Project Structure

Run `ls src/lib/ src/components/ src/server/routers/` for the live layout.
Key concept → directory map:

| Concept                 | Directory                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Calculators (pure)      | `src/lib/pure/<area>/`: accounts, advice, budget, contributions, debts, household, investments, net-worth, paycheck, retirement, savings, simulation, sync, tax                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Engine modules          | `src/lib/pure/engine/` (<!-- AUTO-GEN:engineModules -->33<!-- /AUTO-GEN --> modules)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Calculator I/O types    | `src/lib/pure/<area>/*.types.ts` beside each calculator; the engine's in `src/lib/pure/engine/types/` (no barrel)                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Shared utilities        | `src/lib/utils/` (dates, formatting, math; no domain logic)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Config tables (declare) | `src/lib/config/` (account types, tax, RMD, IRMAA, ACA)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| DB schema               | `src/lib/db/pg/*.ts` (re-exported by `schema-pg.ts`; <!-- AUTO-GEN:tables -->84<!-- /AUTO-GEN -->+ tables)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| tRPC routers            | `src/server/routers/` (<!-- AUTO-GEN:primaryRouters -->27<!-- /AUTO-GEN --> primary + <!-- AUTO-GEN:settingsSubRouters -->5<!-- /AUTO-GEN --> settings sub-routers)                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Auth + tRPC middleware  | `src/server/auth.ts`, `src/server/trpc.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Pages (App Router)      | `src/app/(dashboard)/` (<!-- AUTO-GEN:pages -->36<!-- /AUTO-GEN --> pages)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Shared UI primitives    | `src/components/ui/` (<!-- AUTO-GEN:uiComponents -->36<!-- /AUTO-GEN --> components)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Domain components       | `src/components/{paycheck,budget,savings,networth,performance,mortgage,settings}/` — paycheck (<!-- AUTO-GEN:paycheckComponents -->21<!-- /AUTO-GEN -->), budget (<!-- AUTO-GEN:budgetComponents -->20<!-- /AUTO-GEN -->), savings (<!-- AUTO-GEN:savingsComponents -->22<!-- /AUTO-GEN -->), networth (<!-- AUTO-GEN:networthComponents -->9<!-- /AUTO-GEN -->), performance (<!-- AUTO-GEN:performanceComponents -->17<!-- /AUTO-GEN -->), mortgage (<!-- AUTO-GEN:mortgageComponents -->9<!-- /AUTO-GEN -->), settings (<!-- AUTO-GEN:settingsComponents -->29<!-- /AUTO-GEN -->) |
| Dashboard cards         | `src/components/cards/` (<!-- AUTO-GEN:dashboardCards -->23<!-- /AUTO-GEN --> cards)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Budget API clients      | `src/lib/budget-api/` (YNAB + Actual)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Migrations              | `drizzle/` + `drizzle-sqlite/` (<!-- AUTO-GEN:migrations -->16<!-- /AUTO-GEN --> squashed baseline per release; PG in `drizzle/`, SQLite in `drizzle-sqlite/`)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Scripts                 | `scripts/` (seed, validate, verify-docs, release)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Tests                   | `tests/` (Vitest)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Docs                    | `docs/RULES.md`, `docs/DESIGN.md`, `docs/TESTING.md`, `docs/OPS.md`, [`docs/CALCULATIONS.md`](CALCULATIONS.md) (every calculation: function, authority, tests)                                                                                                                                                                                                                                                                                                                                                                                                                       |

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

Auth.js with Authentik OIDC or a local admin (`local_admins`). Dev Login (any name, no password) is registered only in development builds, and a token is accepted only with the `authMethod` its provider stamped at sign-in. Whether this is a development build, and whether requests skip sign-in (`next dev` only), is answered once, in `src/server/auth-mode.ts`. Local admin is the default install's sign-in (Authentik is optional). Its sign-ins are throttled in `src/server/local-admin-login.ts`. Each attempt is counted before the password check (so parallel requests can't slip past) per client address (`clientAddress`, as the API rate limit keys it) and per email; a sign-in clears both. After 5 attempts an address is refused, and after 10 an email is refused from any address that already has an attempt in the window, so the admin can still sign in from a clean address; each lock ends 15 minutes after its first attempt. An unknown email costs the same scrypt check, and no password is logged. Base roles + permission addons:

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

The `(dashboard)` layout redirects to `/login`; `src/proxy.ts` runs `auth` but has no `authorized` callback, so it blocks nothing. Permission enforcement is at tRPC procedure level, and API routes check for themselves. UI gating via `UserContext` (`useUser()`, `hasPermission()`, `isAdmin()`).

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
- **No amounts in server HTML.** Pages that prefetch data for hydration use `prefetchForPage()` (`server/trpc-server.ts`), which skips the prefetch when the cookie is set, so the first HTML has loading states instead of amounts. New prefetching pages must use it, not `createServerHelpers` directly.
- **Toggling remounts the page.** `DashboardShell` keys its content on the privacy state so every formatter re-runs; the React Query cache survives (no refetch) but unsaved inline-edit state on the open page resets.
- **The squiggle font.** `maskedAmount()` emits Private Use Area characters U+E000–E007, drawn by `src/app/fonts/ledgr-redacted.woff2` (generated by `scripts/gen-redacted-font.py`; family "Ledgr Redacted"). `globals.css` appends that family to Tailwind's `--default-font-family` / `--default-mono-font-family` and the `.font-sans` / `.font-mono` utilities, so it only draws those code points. Not next/font's `fallback` option (it drops the size-adjusted Plex fallback) and not extra faces on the Plex family (Chrome skips faces with different weight descriptors).
- **Deliberately not masked:** percentages, counts, dates, editable inputs, growth ratios such as the Retirement card's Growth benchmark (`data-privacy-visible`), exports, and the `+` / `-` direction signs components print next to an amount.
- **Guard.** `tests/e2e/privacy-mode.spec.ts` visits every route with the cookie set and fails on any rendered `$<digit>`.

### Settings Architecture

See § Settings Belong on Their Pages for the full domain-to-page mapping.

Each page owns its domain's settings inline. The central Settings page holds only cross-cutting data: people and household, reference data (IRS limits, tax/LTCG brackets, IRMAA, ACA/FPL, return rates), integrations, access control.

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

Helpers: `taxTypeTextColor()`, `taxTypeLabel()`; bar fills read `TAX_TYPE_COLORS[key].bg`

**Label convention:** The DB stores IRS bucket keys (`preTax`/`taxFree`/`hsa`/`afterTax`) — these are the correct data model. The UI displays user-friendly labels via `taxTypeLabel()`: `preTax → "Traditional"`, `taxFree → "Roth"`. These are the terms on Vanguard statements, 401k enrollment, and finance articles. IRS-level context is available in `TAX_BUCKET_DESCRIPTIONS` tooltips (e.g. "Traditional (pre-tax) contributions..."). Payroll terms like "Pre-Tax Deductions" on pay stubs are a different concept (payroll section headers) and are not changed.

### Design Rules

- Account types and tax treatments use distinct hue families — no overlap
- Generic UI badges (BG, PC, etc.) use indigo or gray to avoid collision
- **Contrast floor (WCAG 1.4.11):** a data-carrying chart stroke or its legend swatch must clear 3:1 against the card background (and against any fill it's drawn over) in **both** themes. A single `CHART_COLORS` hex often can't — see `chartLinePalette(dark)` in `colors.ts` for the theme-aware escape hatch (mirrors `trajectoryChartPalette`). Decorative reference/zero lines are exempt.
- Account type colors are derived from `ACCOUNT_TYPE_CONFIG` — a `colors` block wires a new account type into `colors.ts` helpers; `CATEGORY_CHART_HEX` is still a separate table
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

Master registry of investment accounts (`performance_accounts` table). Each is self-describing with `accountType`, `subType`, `label`, and `ownerPersonId` columns. Each spans all years and links to both `account_performance` (historical tracking) and `portfolio_accounts` (snapshot rows) via FK.

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

A sub-account is a snapshot row's identity — tracked account + tax type + kind (`subType`) + owner — built by `snapshotAccountKey()` (`lib/pure/accounts/portfolio.ts`). There is no sub-account table: sub-accounts exist only as snapshot rows, and the key is how a row is recognised across snapshots (e.g. carrying forward "inactive"). The owner is part of it because a joint account holds each person's money separately (two people's Roth rows in one joint IRA are two sub-accounts). The free-text `label` is display-only and not part of it.

Institutions report sub-accounts as separate accounts (Vanguard: one Roth IRA, Traditional IRA and Rollover IRA per person). A SimpleFIN account therefore links to a tracked account and, optionally, one of its sub-accounts (`simplefin_accounts.linked_sub_key`; null = the whole account, e.g. a workplace plan that reports every tax bucket as one account). Links are suggested from institution + account kind (`lib/config/simplefin-account-kinds.ts`) + balance closeness, assigned to minimise the total balance gap, never taking an already-linked sub-account, and only applied when the household confirms. A link whose sub-account leaves the latest snapshot is kept, flagged, and counts for the whole account meanwhile.

#### SimpleFIN investment data

- **Precision.** Money is `decimal(14,2)` everywhere, as elsewhere in Ledgr. Share counts and per-share figures (`holding_observations.shares`, `avg_cost_per_share`) are `decimal(20,8)`: funds report fractional shares to 3–6 places and a per-share cost to more, and shares × price must reproduce the institution's value to the cent. Never round shares to money precision.
- **Which accounts count.** A SimpleFIN account feeds its tracked account only when it's linked _and_ checked (`countsAsFeed` in `lib/pure/sync/simplefin-feeds.ts`; SQL form `countedFeed`). An unchecked account keeps its link but is ignored by every total, comparison, fill and check; its tracked account goes by its manual snapshot balance. HSA card-spending redaction still follows the link.
- **Comparing live with a snapshot** needs the live balance to cover the whole account the way the snapshot does (`liveCoversAccount`): every part linked (or a whole-account feed), and no feed whose money sits outside a part.
- **Fill from SimpleFIN** (snapshots, Performance, Basis) is suggest-then-save. What a saved fill counted is an app-setting ledger per year (`server/services/sync/fill-ledger.ts`): each row's baseline day plus the transaction ids counted and how (`kind`, conversion flag), so late, newly settled or reclassified rows are corrected rather than missed or double counted.
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

- **Finalized years:** stored as-is, trusted as source data
- **Current year:** `ending_balance` follows the latest snapshot; other fields are entered (or filled from SimpleFIN); shown "In Progress"

### Row Synthesis

For years with `account_performance` data but missing `annual_performance` category rows, synthetic rows are computed at read time. Single-category years copy from the stored annual row to avoid account-level sum discrepancies.

### Return % (Simple Dietz, midpoint weighting)

```
return = gain_loss / (beginning_balance + (contributions + rollovers - distributions - fees) / 2)
```

`contributions` (total_contributions) already includes employer money for
every account type — do not add employer_contributions again. See
`computeReturn()` in `src/lib/pure/investments/returns.ts`, the single canonical
implementation.

On finalized rollup (`annual_performance`) rows the stored value is trusted and nulls are computed; per-account returns are always computed. Division-by-zero returns null.

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
// lib/pure/<area>/xxx.types.ts — the calculator's I/O types, decoupled from Drizzle
type XxxInput = { /* all number, never Drizzle string */ asOfDate: Date; };
type XxxResult = { /* outputs */ warnings: string[]; };

// lib/pure/<area>/xxx.ts — pure function
export function calculateXxx(input: XxxInput): XxxResult { ... }
```

**tRPC routers** fetch from DB, convert strings via `toNumber()`, call calculators, return typed results.

### Key Calculators

| Calculator       | Key Output                                                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paycheck         | Per-period breakdown, year schedule (SS cap transition), bonus estimate                                                                                                                                                                                       |
| Tax              | Effective/marginal rates, total liability                                                                                                                                                                                                                     |
| Budget           | Tier totals, essential/discretionary split                                                                                                                                                                                                                    |
| Contribution     | Utilization %, savings rate vs 25% target, "money left on table"                                                                                                                                                                                              |
| Mortgage         | Amortization schedule, payoff projection, interest savings                                                                                                                                                                                                    |
| Engine (modular) | Unified accumulation + distribution projection with bracket-filling withdrawals, RMDs, Roth conversions, SS tax torpedo, LTCG brackets, Guyton-Klinger guardrails, IRMAA/ACA awareness                                                                        |
| Net Worth        | Wealth Score, FI progress, tax-bucket allocation                                                                                                                                                                                                              |
| Milestones       | `lib/pure/advice/milestones/milestones.ts` `evaluateMilestones()` — every Money Guy / Bogleheads / Fidelity rule and custom goal judged once (status, reached year from history, expected year from the projection); thresholds in `lib/config/milestones.ts` |
| Savings          | Months of coverage, goal projections                                                                                                                                                                                                                          |
| E-Fund           | Essential expense coverage months                                                                                                                                                                                                                             |
| Brokerage Goals  | View enricher: maps engine projection to per-goal status (funded/shortfall/tax cost)                                                                                                                                                                          |
| Monte Carlo      | 500-trial simulation by default (Coast FIRE 1,000, strategy comparison 200; about 1.3 points of standard error on a 90% success rate at 500), with asset class correlations, glide path allocations, configurable presets                                     |
| Random           | Distribution utilities (normal, log-normal) for Monte Carlo                                                                                                                                                                                                   |
| Relocation       | Budget comparison, FI target/age impact, earliest safe relocation, large purchase modeling                                                                                                                                                                    |

### Relocation Calculator

The relocation decision tool (`lib/pure/retirement/relocation.ts`) compares two budget scenarios year-by-year:

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

1. **Purchase year**: retirement money (the Retirement-parented balance the calculator starts from) pays `purchasePrice × downPaymentPercent` (cash outlay) and gets `saleProceeds`. Net impact shown in `largePurchaseImpact`.
2. **Loan payments**: Monthly amortization payment added to relocation expenses for `loanTermYears` starting at `purchaseYear`.
3. **Ongoing costs**: Added to relocation expenses from `purchaseYear` onward (permanent).
4. **FI target**: Increased by ongoing costs (they're retirement expenses too). Loan payments do NOT increase FI target (they end).

### The Projection Engine

`lib/pure/engine/` runs accumulation and retirement in one pass, year by year. Module map and per-year order: `engine/ARCHITECTURE.md`. Public API: `engine/index.ts`.

1. **Accumulation** (today → retirement): contributions routed per account from the contribution specs (or waterfall / percentage), IRS limits (over-limit money reaches a Retirement brokerage only in some later years; RULES.md § Known Gaps), employer match, salary growth with a cap (each person's salary grows at its raise rate and stops at the cap), Roth/Traditional splits, lump sums, brokerage goals.
2. **Retirement** — three withdrawal routing modes:
   - **Bracket filling** (default): Traditional up to a target bracket, then the rest ranked by each year's real cost — Roth basis (free) and brokerage draws inside the 0% LTCG room first, then whichever of Roth growth or brokerage gains is cheaper (NIIT-aware), HSA on the same footing (`withdrawal-cost-ranking.ts`). Once Roth, brokerage and HSA are gone, Traditional above the target. Needs a `rothBracketTarget` and brackets; otherwise waterfall. A brokerage draw takes basis in proportion to the account's balance (average cost, not lot by lot).
   - **Waterfall:** accounts in priority order with per-account and per-tax-type caps.
   - **Percentage:** fixed shares, with an emptied or capped account's share placed on the others. Once the accounts with a share are full or empty, accounts with a 0% share take the rest, in proportion to what each can still give.
   - The withdrawal is grossed up to cover its own tax: federal income tax from the IRS Pub 15-T percentage-method tables with the rest of the standard deduction taken off first, which gives the tax owed, not withholding (with a tax multiplier, which scales the computed tax for future rate changes; 1.0 is current law), Social Security taxation (provisional income), NIIT, early-withdrawal penalties.
   - Spending follows the household's strategy (fixed, Guyton-Klinger and seven others). A spending-sized strategy's figure, less Social Security, is what the gross-up works from. A portfolio-sized one (Constant Percentage, Endowment, Vanguard Dynamic, VPW, and RMD Spending in its RMD years) is the gross withdrawal itself, tax paid out of it and Social Security on top, unless the household's "Social Security comes out of this amount" switch is on. Guardrails judges its rate before the gross-up: (spending − Social Security) ÷ last year-end retirement balance, tax left out.
3. **Tax-aware features** (data in `lib/config/`): RMDs (Uniform Lifetime Table only, SECURE 2.0 start ages; the Joint Life Table, required when the sole beneficiary is a spouse more than 10 years younger, isn't used), QCDs, graduated LTCG, Roth conversions into bracket room (and RMD smoothing), IRMAA and ACA cliffs, the OBBBA senior deduction, inflation-indexed thresholds.

Every setting can change by year ("Changes by year", resolved in `override-resolution.ts`).

**Retirement scope and the plan judge.** Every year row carries two balances from one helper (`scopedBalances`, `balance-utils.ts`): `retirementBalance` — the aggregate minus Portfolio-parented accounts (`computeNonRetirementExclusion`, the same exclusion routing uses) — and `allAccountsBalance` (net-worth views only, lint-guarded). Depletion is retirement money running out. Whether a plan works is decided once, by `assessPlan` (`lib/pure/retirement/plan-outcome.ts`): the first retirement year with material unmet spending (the engine's `unmetNeedMaterial`, floor `shortfallMaterialityFloor`) or with retirement money gone while later years still need withdrawals, with a reason (`depleted` / `penaltyGap` / `shortfall`). Simulation trials, Coast FIRE, the optimizers, tax optimization, relocation, stress tests and the report all read it. Routing guarantees that make the verdict meaningful: bracket filling draws Traditional above the target once Roth/brokerage/HSA are gone; percentage mode places an emptied or capped account's share on the others; the gross-up funds what routing actually delivers and prices NIIT; penalty-locked categories are capped at what their tracked accounts can give (`reachableByCategory`). The full contract is § Account Categories. Showing simulated vs baseline figures follows one rule (`simulatedOrBaseline`, `usePlanEngineInput`, `DEFAULT_SIMULATION`) — § Account Categories, "Simulated vs baseline".

**Tax-year resolution:** every tax-figure consumer (the projection engine, the paycheck calculator, `savings.ts`) resolves its year through one function, `resolveTaxParams()` (`lib/config/tax-params.ts`), instead of each maintaining its own `WHERE tax_year = …` query. It picks a year — `tax_params` is an optional per-year vintage marker, not a value store; the existing `contribution_limits`/`tax_brackets`/`ltcg_brackets`/`irmaa_brackets`/`fpl_by_household` tables remain the only value store — and returns that year's slices in the shapes each engine module already consumed. A retirement profile can pin its resolved year via `retirement_profiles.tax_params_year` (NULL = track the latest enacted year, the default for every profile); re-opening a pinned profile reproduces its numbers instead of silently re-pricing when a newer tax year is seeded. The pin is set through `retirement.retirementProfiles.update` (`taxParamsYear`); there's no UI control for it yet. `irmaa_brackets` and `fpl_by_household` feed the engine's IRMAA and ACA checks.

### Projection Card

The Retirement page's projection (`components/cards/projection/`) reads `projection.computeProjection` plus the simulation queries (`use-projection-queries.ts`); the dashboard reads the same cached runs through `usePlanEngineInput`.

- **Per-person view:** Joint / per-person toggle scales the chart, table and hero figures by each person's share of the contribution specs.
- **"How contributions are projected":** per-account specs with employer match inline (`+m`, hover for the breakdown).
- **Withdrawal routing** panel: bracket filling / waterfall / percentage, with the order and tax-preference editors shown only where they apply.
- **Tooltips:** every balance cell breaks down by tax bucket, source and match; In/Out breaks retirement draws into Traditional / Roth / brokerage / HSA / tax.

Shared helpers: `getAccountTypeConfig()`, `aggregateContributionsByCategory()` and `buildContributionDisplaySpecs()` (`lib/pure/contributions/`).

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

One judging path for financial rules: `evaluateMilestones(input)` (`lib/pure/advice/milestones/milestones.ts`) reads a `MilestoneInput` built by `buildMilestoneInput()` (`lib/pure/advice/milestones/input.ts`) from what the app already computes, and returns one `MilestoneResult` per milestone (status `reached` / `onTrack` / `behind` / `unknown`, headline, reached year, expected year, next step). Consumers never judge a rule themselves:

- **Milestones page** (`/milestones`) — everything, by group, plus the FOO ladder, the timeline and "next up".
- **Financial Checkup** (dashboard) — the `CHECKUP_MILESTONES` subset as traffic lights (its savings-rate row is the household's switchable display rate).
- **Retirement card** — Fidelity readiness uses the same checkpoint table and `incomeMultipleTarget()`.

Inputs: year-level history from `milestones.computeInputs` (via `buildYearEndHistory()`), the profile-aware contribution / savings / mortgage summaries, linked holdings (Bogleheads rows), and the dashboard projection (`useDashboardProjection()` — the same engine input as the Retirement card, so one cache entry). Reached dates use finalized years (and the current year for balances); expected dates scan the projection with today's cash held flat, growing today's-dollar targets (FI number, "today's dollars" goals) with inflation since the projection is nominal. The household's own goals and checklist live in `app_settings` (`milestone_custom_goals`, `milestone_checklist`), validated on write by the generic settings upsert. Where two sources disagree, the household picks one and every surface follows it: `milestone_checkpoint_source` (Money Guy liquid-investment checkpoints vs Fidelity retirement-savings checkpoints) drives the Milestones page and the Retirement card's Readiness; `milestone_savings_target_source` picks Money Guy's 25% (Retirement + Portfolio) or r/personalfinance's 15% (Retirement only) for the savings-rate milestone (FOO steps stay Money Guy's). r/personalfinance also adds mega backdoor Roth room (IRS total-additions limit `401k_total_additions_limit`, config `irsLimitKeys.totalAdditions`), near-term brokerage goals, and per-fund expense ratios. FOO step 6 counts every account in the Retirement parent category (employee money against each IRS limit), and is also met by a Retirement-only savings rate of 25% (judged to whole percents) — that rate counts the employer match below the household's high-income threshold and leaves it out above it, like the 25% savings-rate milestone; step 5 is the config's `fooStep: 5` types (IRA, HSA).

## Current glide path (Benchmarks)

The household can set a **current glide path** — its target mix by age for what it holds today — on Benchmarks ("Your mix vs your target"). It's separate from the retirement simulation's glide path (`mc_preset_glide_paths` for a named preset, `glide_path_allocations` for Custom), so the real portfolio can be held more conservatively than the plan projects with. Stored in `app_settings.current_glide_path`, validated on write (`currentGlidePathSchema`: each age's mix adds to 100%); `loadHoldingsOverview` interpolates it at the primary person's age when set and falls back to the simulation's glide path when not (`targetSource`). Benchmarks' mix vs target and Milestones' rebalancing both read that target. Allocation counts only SimpleFIN accounts linked to a Ledgr account; unlinked ones are listed as left out. "What it costs" keeps the two kinds of cost apart (`COST_KINDS` in `lib/config/performance-help.ts`): **fund costs** — value × expense ratio (`blendedCost`), a rate on today's balance, already inside fund prices and so inside Performance gains — and **account fees**, the Performance Fees column per year (`accountFeesForYears`); the headline adds a year of each (`allInYearlyCost`), never folding one into the other. Next to "What it costs", a stacked chart shows that glide path by age (asset-class colors from their fund categories) with Vanguard Target Retirement's stock share (`VANGUARD_TDF_STOCK_SHARE`, shifted to the household's retirement age) as a dashed line to compare with the top of the stock bands.

## Household annual income and tax

This year's income figures come from one model: `computeAnnualEarnings()` (`lib/pure/household/household-income.ts`), built from each person's paycheck result — salary plus the **resolved** bonus (the set bonus if there is one, else the formula), pre-tax money (pre-tax payroll contributions on regular checks and — for accounts set to `fromBonus` — on bonus checks, `annualContributionWithBonus`'s rule, plus pre-tax deductions) and FICA wages (gross less Section 125 deductions and payroll contributions to an account type with `payrollFicaExempt` — HSA — within its yearly cap: the IRS limit less employer money (`payrollFicaExemptCap`), one cap shared across a person's rows of the same account type (`shareFicaExemptCaps`), age at Dec 31 from `ficaCapContext`; only pre-tax rows count). A job counts only the checks it pays inside the year: the current job from its start date (none before it — `periodsBeforeStart`; a bonus dated before the start isn't its), plus any job that ended this year, from its own Salary Profile entry through its end date; the paycheck summary sums a person's jobs (`jobPaycheckSetup` builds each one's paycheck the same way). A person whose year starts with the current job and no earlier job counted gets `yearPayNote` (the Taxes page says pay before the start isn't counted). The IRS-limit caps still size a full year at the current job (see TODO). The paycheck router returns it per person and as `householdIncome`; the annual tax, the Income card, Living Costs and MAGI all read it. A job's bonus can go to extra spending instead of the budget (Salary Profile entry `bonusDestination`): Living Costs then shows its take-home (`bonusSpendingNet`) as its own bar.

`calculateHouseholdTax()` figures the year's liability for this year's tax-return filing status (`lib/pure/tax/filing-status.ts`: the household setting `tax_filing_status`, else the active Retirement Profile's, else a W-4 from the request's Salary Profile — `thisYearFilingStatus` in `server/services/tax/filing-status.ts`, which the IRS-limit caps, the Roth IRA phase-out and the engine's year-0 caps share; retirement years use the profile's status, or this year's when the profile is set to Auto (`filing_status` null); nothing known → Single, and a recommendation asks): federal on the combined income with one standard deduction; Social Security per person on FICA wages, capped at the wage base; Medicare per person; and the 0.9% Additional Medicare Tax on the household's combined Medicare wages above the filing status's **liability** threshold (`fica_medicare_surtax_liability_<status>`). Employers withhold it per employee above a separate **withholding** threshold (`fica_medicare_surtax_threshold`, IRC 3102(f)) — that row belongs to paycheck withholding only; the household tax uses it just to say how withheld and owed differ (Form 8959). Both are seeded reference rows, admin-editable. The NIIT thresholds, by contrast, stay in engine config: they're statutory, not indexed, and only the retirement engine reads them — don't "fix" one toward the other. The effective rate is federal ÷ wage AGI, the tax-return definition; FICA is its own line. Actual-YTD withholding is summed from the year schedule (`withheldThroughPeriod`), which charges full Social Security until the wage base and Additional Medicare once this employer's Medicare wages pass the withholding threshold — the per-check figure is the year's Social Security averaged over every check. A bonus check is withheld at the supplemental rate on its federal taxable wages (gross less the pre-tax money it takes).

Roth IRA MAGI (`buildRothIraView`, `lib/pure/contributions/roth-ira.ts`) = wage AGI − HSA money paid outside payroll + taxable investment income (`lib/pure/investments/investment-income.ts`: dividends and interest in taxable account types, this year so far plus last year's rest-of-year per feed, annualized where a feed's history is shorter; a tax year that hasn't started uses this year's estimate). Roth conversions are left out of both sides; the traditional IRA deduction isn't modelled. The verdict needs a safety margin below the phase-out start (default the range width, `roth_ira_direct_margin` setting). The detail lives on the Taxes page (Planning → Taxes: `TaxBreakdown` + `RothIraSection`); the dashboard's Household Income card stays light — two tax lines and one Roth IRA line (`RothIraLine`) linking there.

## Holding history

`holding_periods` / `holding_period_weights` store only **entered** (and, later, inferred) periods — funds and their weights (share of the account, not share counts) per account over dates. **Per part:** an account whose counted feeds are linked to parts (`simplefin_accounts.linked_sub_key` — e.g. a joint IRA with one feed per person and tax type) keeps one history per part (`holding_periods.sub_key` = `snapshotAccountKey`; `accountSplits` decides, sticky while part periods exist; part and whole-account feeds at once is a conflict shown to the household). Every other account — a 401(k) whose parts share one whole-account feed — keeps one whole-account history (`sub_key` null). A split account's parts are every part it has had in any snapshot plus its feeds' parts (`loadAccountPartHistory`); a stored period with no holder is orphaned (shown to move or delete, never counted). **Observed** periods are derived on read from `holding_observations`: `holdingsByAccountDay` groups each account's holdings by day, carrying each feed's latest holdings forward so an account fed by several feeds that report on different days reads as one holding; `deriveObservedPeriods` starts a new period when the set of funds changes or the data skips more than `HOLDING_PERIODS.observedMaxGapTradingDays` trading days, and leaves the last one open only while the feed still reports. Priority where they overlap: observed → entered → inferred (`periodOn`). The matched-mix benchmark (`lib/pure/contributions/matched-mix.ts`) prices weights with one index fund per composition bucket (`BUCKET_INDEX_PROXIES`): in the observed window the actual (drifting) weights on each month's first observed day, for entered periods their fixed weights (rebalanced monthly); accounts weighted by beginning-of-year balance; a split account's month is built per part (its observed month, else its entered period) and the parts combined by their snapshot shares (`partSharesOn`: latest snapshot on or before the month, the earliest before the first; a part not in it = 0) — when every part with money was observed that month, that is the account's pooled daily mix; a month counts only when every account is covered and the priced share reaches `HOLDINGS_MIN_COVERAGE`. The monthly level runs through the same `simulateIndex` as every benchmark (`matchedMixRun`).

## Recommendations

`/recommendations` (and the Checkup's "N recommendations →" link) lists what to do next, ranked. `lib/pure/advice/recommendations.ts` gathers from results other engines already judged — each source is an adapter that only maps fields (`recommendationsFromMilestones`: Behind or alerting milestones with a next step, areas from `lib/config/recommendations.ts`). Urgency is the source's own (alert → now, behind → soon); dollars are the milestone's `impact`, set where the gap is computed. `rankRecommendations` orders by urgency, then yearly dollars, then configured order; one-time and yearly amounts are never compared. Both the page and the Checkup read `useRecommendations()`, which uses `useMilestones()` — its holdings and brokerage-goal rows are permission-gated inside the hook, so every caller judges the same set. Investment items are adapters too: Roth IRA and pro-rata (`recommendations-roth.ts` over `buildRothIraView`, date windows in config), cash drag and HSA cash (`recommendations-cash.ts` over `lib/pure/accounts/cash-positions.ts`), tax-loss harvesting and cheaper equivalent funds (`recommendations-funds.ts` over `lib/pure/investments/fund-findings.ts`); `useInvestingFindings()` gathers the investing inputs behind the portfolio permission.

## Savings Page Architecture

The Savings page has three sections, each tracking a different savings strategy:

### 1. Emergency Fund (Cash)

Months of essential expenses covered. Uses `efund` calculator with budget tier selection.

### 2. Sinking Funds (Cash)

Monthly-contribution goals for near-term purchases. Managed via `savings` calculator with planned transactions and allocation overrides.

### 3. Long-Term Goals (Brokerage)

Yearly brokerage-funded goals (e.g., new car in 2030). Unlike sinking funds held in cash, these are invested and subject to capital gains tax on the gains portion.

**Engine-integrated:** long-term goals are drawn inside the engine's accumulation years, not by a separate calculator, so:

- goal draws come only from **Portfolio** brokerages and reduce them before retirement sees anything (holistic rule);
- cost basis is tracked **per brokerage account** (`brokerage-basis.ts`): it starts at the account's entered cost basis; money the projection adds (contributions, match, overflow, reinvested RMD money, lump sums) adds basis 1:1, growth doesn't, and draws take basis in proportion (average cost). A rollover is not a contribution (§ ESPP Accounting);
- tax is on the gain only, at the brokerage distribution rate.

```
brokerage_goals → engine input (brokerageGoals)
  → accumulation years draw by target year + priority (Portfolio brokerages)
  → brokerageGoalWithdrawals per year
  → brokerage-goals calculator (view enricher) → per-goal status
```

**Schema:** `brokerage_goals` (name, target amount, year, priority, active, notes). Basis lives on `performance_accounts.cost_basis`.

**UI:** `components/cards/brokerage-goals.tsx` (cards + summary figures).

---

## Profiles and Plans

From the user's seat: each profile is its own world, and only the active one
counts. The header shows the active Salary, Contribution, Budget and
Retirement profile and the view mode; every page uses exactly those. A
**Plan** is a saved set of those four — applying it makes them the active
ones; changing any one picker leaves "None (unsaved mix)". The What-If tab is
the only sandbox, and it never writes the active profiles. Rules and
mechanics: § Rules and mechanics and § Profile Resolution below.

What each kind holds:

- **Salary Profile** — one complete entry per job: salary, bonus terms, where
  the bonus goes (`bonusDestination`), pay schedule, W-4 elections,
  extra-paycheck routing, other pay (see
  `resolveCompensation`/`mergeSalaryProfileJobFields` in
  `lib/pure/household/compensation.ts` and § The Salary Profile layer). "How
  much do I earn" and "what withholding/schedule elections apply" are one axis
  — an accepted tradeoff. A job's employer name is fixed once created.
- **Contribution Profile** — contribution account values/methods/match,
  whether each payroll account is also taken from bonus checks (`fromBonus`),
  and deduction amounts. It never touches `jobs`.
- **Budget Profile** — budget items per column (spending level); savings
  goal allocations (%/$) are a facet of it (`savings_goal_profile_allocations`
  is keyed to `budget_profile_id`), not a fifth kind. Annual expenses are the
  active column × 12. A profile with month weights (`column_months`, an
  explicit blend) instead adds each column's monthly total × its months, and
  the active column doesn't apply.
- **Retirement Profile** — retirement assumptions (ages, inflation, strategy).

Resolution: page-local selection (profile managers, What-If) → active. Budget
columns are spending levels with no profiles of their own, and there is no
Plan tier.

### Rules and mechanics

**Each profile is its own world.** Salary, Contribution, Budget and
Retirement profiles are independent of each other and of every other profile
of the same kind. There is no default, "Main" or "Live" profile and no
baseline to diff against — only the **active** profile of each kind
(`app_settings.active_salary_profile_id` / `active_contrib_profile_id` /
`active_retirement_profile_id`, `budget_profiles.is_active`). Every page shows
the active profiles, and an edit to a profile field saves to the profile it
belongs to.

**The first Retirement profile** is "Current Retirement", made once by
`adoptFirstRetirementProfile` (`server/services/profiles/first-retirement-profile.ts`) from
the household's first saved retirement settings: on the first
`retirementSettings.upsert` with no profile, on `completeOnboarding`, and by
the demo seed. It takes every settings row with no profile, adds everyone
without one the way `people.create` adds a person (one helper), so each
person has both rows, and makes the profile active, in one transaction
under the first-profile lock (which `people.create` takes too). An install that already has a
profile is never touched.

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

**What-If** (Profiles page tab) is the only unsaved sandbox: its pickers and
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
one. `budget.computeActiveSummary` takes a `selection` of the page's
Contribution/Salary picks (absent = the active one), with no column tier,
resolved by `resolveProfileSelection` (`server/services/profile-selection.ts`);
callers with no page context pick none. A linked item's dollars are computed once
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

## Data-Driven Architecture

The rules are RULES.md § Data-Driven Architecture.

### Key Files

| File                                                | Role                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/lib/config/account-types.ts`                   | `ACCOUNT_TYPE_CONFIG`, `AccountCategory` (its keys) + every derived helper and predicate         |
| `src/lib/config/account-balance.ts`                 | Balance-structure helpers (Traditional, Roth, basis)                                             |
| `src/lib/config/display-labels.ts`                  | Label maps and performance-category constants                                                    |
| `src/lib/config/account-types.types.ts`             | `AccountTypeConfig` (the entry shape), `AccountBalance` union                                    |
| `src/lib/constants.ts`                              | App-wide defaults and thresholds                                                                 |
| `src/lib/config/filing-status.ts`                   | Return and W-4 filing statuses (types, order) and the per-status rules table; no Zod             |
| `src/lib/config/filing-status.schema.ts`            | The two filing-status Zod schemas, apart so client bundles skip Zod                              |
| `src/lib/config/age-rules.ts`                       | `AGE_RULES`: each age rule and how it is measured (tests go through `lib/pure/household/age.ts`) |
| `src/lib/config/magi-definitions.ts`                | `MAGI_DEFINITIONS`: what each rule's MAGI counts of Social Security                              |
| `src/lib/config/permissions.ts`                     | `PERMISSIONS` and `Permission`, shared by the server and the client                              |
| `src/lib/config/budget-apps.ts`                     | `BUDGET_API_SERVICE_VALUES`, `BUDGET_SERVICES` labels, `isBudgetApiService`; no Zod              |
| `src/lib/budget-api/providers.ts`                   | `BUDGET_PROVIDERS`: one entry per budget service, with its client                                |
| `src/lib/pure/tax/year-income.ts`                   | `YearIncome` (one year's income by stream) and `yearMagi`                                        |
| `src/lib/pure/contributions/contribution-amount.ts` | A contribution's yearly dollars, `Fraction` and `EmployerMatch`                                  |
| `src/server/data/request-scope.ts`                  | `RequestScope`: a procedure call's db, instant and household day                                 |
| `src/lib/pure/simulation/dollars.ts`                | The Simulation's outcomes in a view's dollars (today's or nominal)                               |

The rest of `src/lib/config/` holds the other data tables (tax, RMD, IRMAA, ACA, NIIT, Social Security, milestones, recommendations, withdrawal strategies, …) — one module per subject.

### Fixing a violation: read a behavior field

When you find a category check (`=== '401k'`, `isHsaCategory(cat)`,
`parentCategory === 'Portfolio'`, etc.), ask what the code needs to know
about the account, and read the config field that says it (RULES.md
§ Data-Driven Architecture, rule 10):

1. If a field and its helper exist (`getLimitGroup` reads `irsLimitGroup`,
   `isOverflowTarget`, `tracksCostBasis`), call the helper. Don't reach into
   `ACCOUNT_TYPE_CONFIG[cat].field` from the call site.
2. If not, add a field to `AccountTypeConfig` named for the behavior (as
   `earlyAccessRule` and `qcdEligible` are), set it on every entry, and add
   its helper in `src/lib/config/account-types.ts` with a one-line doc
   comment naming the field.
3. Update every call site to use it.

Never add a predicate that names an account type (`isHsaCategory`,
`isIraCategory`): a new type with the same behavior would have to be added
to it by hand. Inside the engine, dispatching on `balanceStructure`
(`roth_traditional`, `single_bucket`, `basis_tracking`) is allowed, since
that is the shape of the balance, not its identity; outside the engine, use
the helper (`tracksCostBasis`).

### Contribution Stubs

When a contribution account is created linked to a performance account, inactive stubs are auto-created for all `supportedTaxTreatments` defined in the config. This ensures the UI always shows the full account structure. Components show inactive stubs as dimmed rows.

---

## Engine Modularity

> **Each engine concern lives in its own module.** The projection engine (`lib/pure/engine/`) is a set of focused modules plus the `projection-year-handlers/` package (per-year setup, accumulation and decumulation steps). Never add logic inline in the orchestrator — extract it into a module with a clear interface.

The orchestrator (`projection.ts`) calls modules in an explicit pipeline order; each module is a pure function with typed inputs and outputs. **The module map — what each one does and how they depend on each other — lives in `src/lib/pure/engine/ARCHITECTURE.md`.** Keep it current when adding or removing a module.

### Rules

1. **No new logic in the orchestrator.** `projection.ts` calls modules — it doesn't implement financial logic itself. New features (e.g., a new tax-aware optimization) get their own module.
2. **Explicit pipeline order.** The per-year order is defined in the year handlers and listed in `engine/ARCHITECTURE.md` § One year. Changes to it must be intentional and update that list.
3. **Module interfaces are contracts.** Each module declares its input type. Callers pass data through the interface — they don't reach into module internals or share mutable state.
4. **Override resolution is centralized.** All per-year sticky-forward config resolution goes through `override-resolution.ts`. No module implements its own override logic.
5. **Balance operations use utilities.** Clone, deduct, grow, and track operations use `balance-utils.ts`, `balance-deduction.ts`, `growth-application.ts`, and `individual-account-tracking.ts`. Never inline balance math in the orchestrator or other modules.

### Public API

`engine/index.ts` is the only entry point: `calculateProjection()`, the tax helpers `estimateEffectiveTaxRate()`, `incomeCapForMarginalRate()`, `marginalRateAboveTarget()`, `computeTaxableSS()`, `rankWithdrawalTiers()` (withdrawal cost ranking) and `shortfallFloor()` (the shortfall floor (gap and retirement years)), plus their types. Code outside the engine may also name its types, and the Zod schemas for its stored inputs, through `engine/types/index.ts`. Everything else is internal to `engine/`.

---

## The Holistic Rule in practice

The rule is RULES.md § The Holistic Rule.

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

| Data                               | Source                                                                        | Key                                                                                                                                                                                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Year-level financial data          | `buildYearEndHistory()`                                                       | `YearEndRow` from `net_worth_annual` + live current year                                                                                                                                                                                                    |
| Tax location breakdown             | `YearEndRow.portfolioByTaxLocation`                                           | JSONB on `net_worth_annual` (finalized) / snapshot (current)                                                                                                                                                                                                |
| Budget column                      | `app_settings`                                                                | `budget_active_column`                                                                                                                                                                                                                                      |
| Annual expenses                    | `getAnnualExpensesFromBudget()` (DB) over `computeBudgetAnnualTotal()` (pure) | Uses `budget_active_column`                                                                                                                                                                                                                                 |
| Total compensation (profile-aware) | `resolveCompensation()`                                                       | `lib/pure/household/compensation.ts` — the single place salary+bonus is computed under a Salary Profile entry                                                                                                                                               |
| Salary override merge              | `applyActiveSalary()`                                                         | Final `active ?? raw` merge of the What-If sandbox salary onto an already-resolved raw salary                                                                                                                                                               |
| Salary override map                | `loadAndApplySalaryProfile()`                                                 | The active (or requested) Salary Profile's entries                                                                                                                                                                                                          |
| Portfolio balances                 | `getLatestSnapshot()`                                                         | Latest `portfolio_snapshots` row                                                                                                                                                                                                                            |
| Contribution accounts              | `buildContribAccounts()`                                                      | `contribution_accounts` table                                                                                                                                                                                                                               |
| Employer match                     | `computeGroupedEmployerMatch()`                                               | Combines Roth/Traditional splits of one account before applying the match cap once; every consumer (`buildContribAccounts`, `buildContributionDisplaySpecs`, `aggregateContributionsByCategory`, `retirement.ts`'s scenario comparison) routes through this |
| Contribution specs                 | `buildContributionDisplaySpecs()`                                             | Per-account specs, incl. match via `computeGroupedEmployerMatch()`                                                                                                                                                                                          |
| Category aggregations              | `aggregateContributionsByCategory()`                                          | Contribution + match totals per account category, incl. match via `computeGroupedEmployerMatch()`                                                                                                                                                           |
| Account type config                | `getAccountTypeConfig()`                                                      | All account-type behavior (from `ACCOUNT_TYPE_CONFIG`)                                                                                                                                                                                                      |
| Parent category map                | `getParentCategory()`                                                         | Account type → goal category (Retirement/Portfolio) via config                                                                                                                                                                                              |
| Mortgage balance                   | `computeMortgageBalance()`                                                    | Amortization from loans + extra payments, or the servicer feed / budget pull in `api_balance` (feed wins)                                                                                                                                                   |
| Financial rules & milestones       | `evaluateMilestones()`                                                        | `lib/pure/advice/milestones/milestones.ts` — Checkup, Milestones page and Retirement readiness all read its results; thresholds in `lib/config/milestones.ts`                                                                                               |
| Household annual income            | `computeAnnualEarnings()`                                                     | `lib/pure/household/household-income.ts` — salary + the resolved bonus, pre-tax money (incl. bonus-check contributions), FICA wages; the annual tax, Income card, Living Costs and MAGI all read it (never re-sum `salary`)                                 |
| Household tax                      | `calculateHouseholdTax()`                                                     | `lib/pure/tax/tax.ts` — federal on combined income, SS per person, Additional Medicare on the household above the liability row                                                                                                                             |
| Roth IRA eligibility               | `buildRothIraView()`                                                          | `lib/pure/contributions/roth-ira.ts` — the Income card panel and the Roth / pro-rata recommendations read it                                                                                                                                                |
| Holding periods                    | `deriveObservedPeriods()` / `periodOn()`                                      | `lib/pure/investments/holding-periods.ts` — observed periods derived from `holding_observations` on read; entered ones in `holding_periods`; per part (`accountSplits` / `partSharesOn`) only for an account whose feeds are linked per part                |

### The Salary Profile layer

`jobs` carries no compensation, schedule, W-4, or extra-paycheck-routing
data of its own any more — it is pure identity/lifecycle (`id`, `personId`,
`startDate`, `endDate`, `isSpeculative`, `employerName`, `title`). Every
number and election a job needs for a live calculation comes from a
**Salary Profile**: `salary_profiles.salaries` maps `jobId` (string key) to
a **complete entry**, `SalaryEntry` (`z.infer` of `salaryEntrySchema` in
`src/lib/db/json-schemas.ts`):

```ts
type SalaryEntry = {
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
`lib/pure/household/compensation.ts` is the single place salary-plus-bonus is computed
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
(`lib/pure/paycheck/paycheck.ts`: paid through payroll — `isPaidThroughPayroll()`,
the one definition — and `fromBonus`). `bonusCheckContribution` (what the
bonus check takes) and the employer match's pay both use it: an account's
match is figured on base salary, plus the bonus only when its own match
group (job/person + account type + parent category — a Roth/Traditional
pair is one account) is taken from bonus checks
(`matchPayGroupsWithBonus`, `lib/pure/contributions/employer-match.ts`). One account's
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

---

## Simulation

The Simulation runs the whole projection many times, each trial with its own random returns. This is what it does today; RULES.md § Known Gaps lists what changes.

- **Trials.** 500 by default (100 to 10,000 accepted); Coast FIRE probes run 1,000 and the strategy comparison 200 (`DEFAULT_SIMULATION`, `lib/constants.ts`). At 500, a 90% success rate has a standard error of about 1.3 points. Trial `i` draws from `createPRNG(seed + i)`. The Simulation page's run takes a random seed, cached with the run; Coast FIRE and the strategy comparison use seed 42, so the options they compare share draws.
- **Where presets come from.** Ledgr ships the Aggressive, Default and Conservative presets with their asset classes, correlations, bucket links (`asset_class_buckets`: each composition bucket to its own class, `other` to none), glide paths (`mc_preset_glide_paths`) and return overrides in `reference-data/simulation-presets.json`. The migrator and every path that rewrites the tables (restore, import, "Reset all data", a demo schema) insert the whole set only when every one of those tables is empty, and never update a row already there: an install's preset rows are its own, and a change to the shipped values reaches existing installs only as a migration. Custom's glide path (`glide_path_allocations`) is the household's own, not shipped.
- **Not configured.** One check decides whether a Simulation can run (`simulationNotConfigured`, `monte-carlo.ts`): the run's named preset is missing (never Custom's mix under its name), there are no asset classes, no glide path, or a glide-path age whose active-class weights are more than 0.1 point off 100%. Then the Simulation, Coast FIRE (search and probe) and the strategy comparison and analyzer don't simulate: they return `notConfigured` and the cards say what's missing, never a 0% run or "not reachable".
- **Returns.** An asset class's stored mean and deviation are the arithmetic mean and standard deviation of its simple yearly return; draws are log-normal with those moments (`logNormalParams`, `random.ts`). Correlations apply to the underlying normal draws, through one Cholesky factor per run. The year's mix is the glide path at the primary person's age that year, interpolated between waypoints, and the blended return is clamped to the preset's limits.
- **Inflation.** With inflation risk on, each year draws one shock around the household's own inflation rates, and the shock moves both rates (`inflation-path.ts`).
- **Success** is the share of trials the plan judge passes (`assessPlan`, DESIGN § Retirement scope and the plan judge). Unmet spending below the materiality floor, $50 or 1% of the year's need, whichever is larger, counts as met, so a trial a few dollars short still succeeds. A failed trial is `depleted`, `penaltyGap` or `shortfall`.
- **Success bars.** 90% (`MC_CONFIDENCE_THRESHOLD`) for Coast FIRE and the strategy comparison's diagnosis; the screens rate 90% and up best and 75% and up next. The report's on-track verdict and action items use 85% (`lib/pure/advice/report/`).
- **Bands** are the 5th to 95th percentiles of each year's retirement balance across all trials (linear between order statistics, R's type 7). Failed trials stay in, at $0 once their money is gone.
- **Today's dollars.** Each trial's figures are divided by that trial's own price index before the percentiles are taken. A row uses the index at its start (`growth(t)`, 1 for the first row): right for the year's withdrawal, but a year-end balance reads high: by a year's inflation for a retired household, and by the part of the first year left at the as-of date for a working one.
- **Fixed-return line.** The Simulation's own fixed-return line compounds, each year, the weighted sum of each class's geometric mean (`routers/projection/monte-carlo.ts`).

---

## Data Model Principles

1. **Person-centric, not employer-centric.** A person has jobs. Jobs change. The person persists.
2. **Generic over specific.** Contribution accounts, savings goals, budget categories — all user-definable.
3. **Snapshots for history, settings for current state.** Time-varying data gets point-in-time records.
4. **Computed values are not stored — with documented exceptions.** Live totals, percentages, and projections are recalculated from source data at read time. **Exceptions** fall into three classes: (a) stored because inputs may not survive, (b) a deliberate point-in-time commitment recorded under whatever was active at save time — the "recorded fact" pattern — which stays fixed even though its inputs DO survive and remain deterministic, because re-deriving it later would mean the value silently changes out from under something that already treated it as settled (a materialized future transaction, a pinned actual), or (c) a pure performance cache of an expensive-but-fully-reproducible computation — inputs survive, recomputation is deterministic, and nothing downstream treats it as settled (unlike (b)), but the computation itself is expensive enough that repeating it on every read is wasteful. Class (c) is only safe when the cache key captures every input that could change the result — an incomplete key silently serves stale-but-presented-as-fresh data, which is exactly the failure mode (a)/(b) don't have to guard against.
   - **`projection_cache`** (`lib/db/pg/api-sync.ts`, `src/server/services/projection/projection-cache.ts`) — the deterministic Retirement engine result, Monte Carlo, and Coast FIRE MC. Class (c): the cache key is a SHA-256 hash of the canonicalized EXACT object passed to the pure calculator (not the raw tRPC input — the router resolves profile IDs into live DB state that isn't otherwise captured, so hashing only the tRPC input would silently serve stale cross-device results). `engineVersion` is folded into the uniqueness constraint; it is a hash of the source files the cached projections run (`scripts/engine-hash.ts` writes `src/lib/generated/engine-hash.ts`; CI fails when it is stale), so a deploy that changes that code invalidates every existing row and Simulation runs draw fresh samples. TTL 36h; eviction is opportunistic (fire-and-forget on write, not cron-driven) rather than a scheduled job, since writes are infrequent relative to reads. `seed` is stored WITH the row (a miss mints one, a hit replays it) so a cached Monte Carlo result stays honestly reproducible rather than a frozen snapshot of randomness masquerading as determinism.
   - **`utility_reading.cost` filled from the budget** (`source` `ynab`/`actual`, the utilities cost feed) — a month's net spend in the mapped budget category, stored because the budget's synced transactions only reach back about a year and a half; older months can't be recomputed, and the household can override any month (a typed cost is never replaced). Refreshed only by an explicit pull the household reviews. Class (a).
   - **`net_worth_annual`** — finalized year-end records capture point-in-time state (tax location breakdown from a Dec 31 snapshot that may later be pruned). Class (a).
   - **`annualReturnPct`** — stored on finalized `annual_performance` rows; recomputed on read for non-finalized years. Per-account returns are always computed on read from the row's own figures (`account_performance.annual_return_pct` is not read). A finalized year's stored return may not be reproducible from its rows (an override, imported history), so an edit to that year's account rows keeps its basis rather than recomputing it (`rebaseLockedReturn`). Class (a).
   - **`lifetimeGains`, `lifetimeContributions`, `lifetimeMatch`** — cumulative fields on `annual_performance`. Computed at finalization from previous year's baseline. **Cascade rule:** when `account_performance` rows on a finalized year are edited, that year's category and Portfolio rows and the lifetime fields of every later year move by exactly what the edit changed — never re-summed from the first stored year, because a baseline can predate the tracked rows (history carried in at setup, an account that changed category). One path does this for every edit (`syncYearRollups` in `src/server/services/performance/performance-rollups.ts`); without it, corrections to historical data silently drift every forward lifetime total. Class (a).
   - **Performance account edits** — one write path, `editAccountRow` (`src/server/services/performance/performance-edit.ts`): a row that balanced before stays balanced (when the edit doesn't set the gain, the gain follows), a row with a deliberate gap keeps its gain; `chainNextYear` moves next year's beginning with a changed ending, and that row's gain follows only if it balanced. A preview (`dryRun`) runs this same path inside a transaction and rolls it back — never a second, "what would change" computation.
   - **Reconciliation checks and accepted gaps** — computed on read (`lib/pure/investments/performance-checks.ts`, loaded once in `server/services/performance/performance-checks.ts`), never stored. A household's acceptance (`account_performance.accepted_checks`) stores the gap it accepted, with its own reason; the check comes back as soon as the gap differs. Estimated marks (`estimated_fields`) are cleared only by the household confirming a figure (or a snapshot setting the ending from a real balance) — finalizing never clears them.
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
database (`db-migrate.ts`, inside the migration's transaction: registered by
tag in `MIGRATION_CONVERTERS` (`src/lib/db/migration-converters.ts`), it runs
in the pending loop and both squash replays, before the tag's SQL when that
drops what it reads, after it when that adds what it writes) and on an older backup being
restored (`backup-transforms.ts` → `transformBackupToCurrentSchema`, e.g.
`transformV0810ProfileSets`). `db-migrate.ts` imports the converter from
`src/` (esbuild bundles it into `db-migrate.js`, so the image needs neither
`src/` nor the Next build): **one copy** serves both paths, as the
reference-data reconcile, the demo-schema stamp and the versioned table list
already do. Converters work
on snake_case rows (JSON as object or text), are idempotent (a no-op once
their source is gone) and write only non-default values; the restore path
also drops the columns the migration drops. A migration that only renames
or removes a JSON key, moving the value unchanged (no arithmetic, no lookup
across rows; migration 0014), may instead be one SQL file per dialect plus a
restore step in `src/lib/db/`, held together by one shared case list that
all three must pass (`tests/db/display-name-custom-cases.ts`). Any
conversion that computes a value uses the one converter. A new migration's tag reaches
`KNOWN_SCHEMA_VERSIONS` from the drizzle journal, so only a data-changing
one needs a transform. The journal has two read paths: `version-logic.ts`
reads it from disk at startup, `backup-transforms.ts` bundles it. Pending migrations apply
strictly, all in one transaction, and the schema is checked against the
latest snapshot (every table, column and index) before it commits: a failed
statement or a missing object rolls everything back and records nothing.
Only a squash replay skips "already done" errors (a replayed unique
violation included on PostgreSQL), and it runs the same check.

### Account Categories

Two `parentCategory` values classify all investment accounts by their goal:

| Category       | Account Types        | Used For                                                    |
| -------------- | -------------------- | ----------------------------------------------------------- |
| **Retirement** | 401k, 403b, IRA, HSA | Retirement projections, contribution engine                 |
| **Portfolio**  | Brokerage            | Portfolio totals only; excluded from retirement projections |

The table shows defaults. A brokerage account can be Retirement-parented (a Retirement brokerage); its `parentCategory`, not its type, decides.

Each account type has a default `parentCategory` in `ACCOUNT_TYPE_CONFIG` (brokerage defaults to Portfolio, retirement accounts default to Retirement). The `parentCategory` is user-editable per account in the Portfolio page and controls all routing — retirement projections include only Retirement-category accounts, the brokerage page shows only Portfolio-category accounts. The config default determines the initial assignment, but `parentCategory` is the single source of truth for behavior.

**Note:** ESPP, Rollover, Employer Match, Profit Sharing are **sub-types** (`subType` field) of their parent account type — not separate account categories. The 5 account categories are: `401k`, `403b`, `ira`, `hsa`, `brokerage`. Sub-types are defined per account type in `ACCOUNT_TYPE_CONFIG.subTypeOptions`.

**Two words, two meanings.** "All accounts" means every account. "Portfolio money" means the Portfolio-parented accounts. Every account is either Retirement money (the subset used for retirement projections) or Portfolio money; together they are all accounts.

**What Portfolio money may and may not affect (the retirement-scope contract, v0.8.11).** Portfolio-parented accounts (savings outside the retirement plan) are never spent in retirement. In the projection engine and everything built on it:

- **Retirement answers read retirement money only** — `retirementBalance` on each year row (every account minus the Portfolio-parented ones, `scopedBalances`): spending strategies and the rate-seeded first year, depletion (`retirementDepletionAge`), the plan verdict (`assessPlan`, `lib/pure/retirement/plan-outcome.ts` — the one judge for success/failure everywhere), simulation success, bands and terminal balances, Coast FIRE, strategy comparison, the Social Security / bracket optimizers, tax optimization, relocation, stress tests, nest-egg figures, and Simple tax mode (which simulates retirement money alone).
- **Retirement money never becomes Portfolio money**: contribution overflow, reinvested RMD money and retirement lump sums go to Retirement brokerages (a projection-only one when there are none); the contribution-rate ceiling caps retirement contributions only. Over-limit money reaches that brokerage only in some later years (e.g. a percent-of-pay row whose pay outgrows the limit); money configured over this year's limit is capped before the projection and isn't saved anywhere (RULES.md § Known Gaps).
- **Portfolio money is never spent for retirement or moved into it**: brokerage goals, the Brokerage page's ramp and lump sums are Portfolio money; balance corrections take from retirement accounts first.
- **`allAccountsBalance` (Portfolio money included) is for net-worth views only** — FI milestones (liquid net worth = every account plus cash) and the Money Guy benchmark. The `local/no-all-accounts-balance` lint rule enforces the allow-list; `tests/pure/retirement/retirement-scope-invariance.test.ts` proves +$1M of Portfolio money changes no retirement answer.
- **Social Security is entered in today's dollars and grows at the general inflation rate (its COLA) in `socialSecurityForYear` alone** — in today's dollars it stays at what was entered. Its taxable share is taxed with the rest of ordinary income (`computeTaxFromSlots`); any benefit above spending pays that tax first.
- **Inflation in the spending strategies: spending-based strategies are real, percentage-based bounds are nominal.** Fixed, Forgo Inflation, Guyton-Klinger, Spending Decline and RMD Spending before the RMD age build on inflation-adjusted figures. Constant Percentage, Endowment and Vanguard Dynamic keep their floors and ceilings in nominal dollars, and say so in their labels: an inflation-adjusted floor would push withdrawals up in bad years, past what the portfolio sustains. Vanguard Dynamic's year is `w = clamp(p × B, w₋₁ × (1 − f), w₋₁ × (1 + c))`, all nominal, with no bounds in its first year (`p` the base %, `B` the retirement balance, `c` and `f` the ceiling and floor). Vanguard's published rule applies the bounds to inflation-adjusted spending (RULES.md § Known Gaps). Constant Percentage, Endowment, Vanguard Dynamic and VPW pay their rate of the balance, so a budget set by year doesn't change what they withdraw.
- **The one coupling: RMDs.** A Portfolio-parented Traditional account counts in its owner's RMD (the IRS doesn't care how accounts are categorized). The whole RMD is paid from the owner's Retirement accounts, which raises taxable income; what they can't pay is that owner's RMD shortfall, shown with its 25% excise estimate, and isn't drawn or taxed (RULES.md § Known Gaps).
- **Each person's RMD comes from that person's own Retirement accounts and never spills to a spouse.** `enforceOwnerRmds` (`rmd-enforcement.ts`) pins it to their accounts; an account with no owner counts as the primary person's (`rmdOwnerOf`, one rule for the RMD base and the pins). What their accounts can't pay is their shortfall: since an RMD is a fraction of last year's balance, that means the money is Portfolio-parented, and the warning says so.

**Simulated vs baseline (one display rule, v0.8.11).** A nest egg (or end balance) is shown through `simulatedOrBaseline` (`lib/pure/retirement/nest-egg-display.ts`) everywhere it appears — the dashboard's Retirement card and the Retirement page's hero:

- With a simulation for the current inputs: the simulated median at the target age (retirement age, or today when already retired), "Range p25 – p75", and "Baseline: $X (fixed returns)". Today's dollars for a simulated figure come from the Simulation itself (`MonteCarloResult.today`, read through `simulationDollars` in `lib/pure/simulation/dollars.ts`): each trial is deflated by the inflation it ran with before the percentiles are taken — never the nominal band deflated at the plan's rate afterwards, which would erase the inflation each trial drew. The baseline is deflated at the plan's rate. Trials vary inflation around the plan's own rates (inflation risk is only the spread, v0.9.5).
- Without one: the baseline, labelled "baseline (fixed returns)", with a pointer to the Retirement page to run the simulation. The dashboard never runs a simulation; it reads the page's cached run.
- A person filter always shows the baseline — the simulation is the whole household's.
- Every surface builds its projection input with `usePlanEngineInput` (and the default simulation is `DEFAULT_SIMULATION`), so the dashboard reads exactly the run the Retirement page made. Cached runs key on the full built input with dates truncated to the calendar day, and expire after 36 h.

**Single source of truth:** `getParentCategory()` from `src/lib/config/account-types.ts`. It reads the `parentCategory` config property for each account type. Contribution and retirement routers use this for page-level filtering (which page owns the account).

#### Performance page display categories

The Performance page uses a **separate grouping** based on `accountType` from the `performance_accounts` master table — not `parentCategory`. This groups accounts by what they _are_, not their goal:

| Display Category | Account Types                                                | Derived From                |
| ---------------- | ------------------------------------------------------------ | --------------------------- |
| **Brokerage**    | All brokerage accounts (Long Term, Retirement, ESPP)         | `accountType = 'brokerage'` |
| **HSA**          | All HSA accounts                                             | `accountType = 'hsa'`       |
| **Retirement**   | 401k, 403b, IRA                                              | Everything else             |
| **Portfolio**    | All accounts combined (a display label, not Portfolio money) | Sum of all categories       |

This mapping is `accountTypeToPerformanceCategory()` (`lib/config/display-labels.ts`). Annual rollup rows (`annual_performance.category`) and account filtering both use this grouping. For `account_performance` rows without a `performanceAccountId`, the system falls back to matching by `institution + accountLabel` against the master table, then to the stored `parentCategory`.

**Where numbers appear:**

- **All accounts:** Net Worth page, Net Worth dashboard card, Portfolio page, Performance page
- **Retirement-only:** Retirement page, Retirement dashboard card, contribution engine projections
- **By account type:** Performance page tabs, Historical page `portfolioByType` breakdown

**Data freshness:** Balance snapshot and performance data are updated manually at different times. A global sidebar indicator shows when each was last updated. Totals may differ between pages because of stale data — this is expected and visible.

**User-editable:** `parentCategory` is editable per account in the Portfolio page and in Settings → Performance Accounts. Users assign each account's "goal" (Retirement or Portfolio). This affects contribution engine routing and retirement projections, but does **not** affect Performance page tab grouping (which uses `accountType`).

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
- **Retirement Profile** (retirement ages, timeline, income, decumulation plan, taxes, healthcare, Social Security — `retirement_settings`) — lives on the Profiles page's Retirement tab, not the Retirement page. Originally page-local, but the other profile levers (Salary, Contributions, Budget, Savings) need visibility into these same assumptions, the same cross-cutting reasoning as Return Rates above — moved here in v0.7.8 rather than duplicated or left orphaned on a page that no longer owns it.

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

## ESPP Accounting

> **ESPP data comes from the ESPP provider's statements. These rules define how those raw figures map to `account_performance` fields.** Any change to ESPP data entry must be consistent with these decisions.

### Accounting decisions

1. **Payroll-year attribution.** Purchase lots belong to the year payroll was withheld, not the settlement year. A lot whose purchase date is in one year and settlement date in the next is a contribution of the purchase year.

2. **`total_contributions` = market value at purchase:** Form 3922 box 4 (FMV on the exercise date) × box 5 shares, not the employee's out-of-pocket cost. This is consistent with how 401k/HSA employer match is handled — total always includes both sides.

3. **`employer_contributions` = that market value − cost basis** (the plan's discount, whatever it is). This is the "employer match equivalent" — it is not a cash contribution by the employer, just the discount portion tracked separately for reporting.

4. **`rollovers` on the ESPP (source) account = negative.** Wire transfers from the ESPP provider to the destination brokerage are outgoing rollovers. Record as negative values. Use the YTD total from the provider's statement, not individual transaction amounts.

5. **`rollovers` on the destination brokerage account = positive.** The same dollar amount appears as a positive incoming rollover on the destination brokerage row. `total_contributions` on the destination must be `$0` — the incoming money is a rollover, not a new contribution.

6. **`computeGainLoss` subtracts rollovers in both directions.** `gainLoss = ending − beginning − contributions + distributions − rollovers + fees`. Outgoing rollovers (negative) add back to G/L; incoming rollovers (positive) subtract from G/L. Both are correct — the ending balance at both accounts already reflects the transfer.

7. **Dividends that stay in the account are not `distributions`.** They are already in the ending balance — or in a later transfer out, counted in `rollovers` — so recording them as `distributions` too counts them twice in the gain. `distributions` is only money paid out to the owner that isn't a transfer to another tracked account (e.g. a dividend paid straight to a bank account).

8. **Brokerage commissions = `fees`.** Foreign withholding tax on dividends also goes in `fees`.

### Source documents

Raw provider inputs (withheld, market value, gross proceeds, commission, dividends) are kept in a local audit file (`.scratch/docs/ops/ESPP_calculations.md`, not in the repo). Verify DB values against it before editing ESPP rows.

---

## Pragmatic Deviations

Documented deviations from general architectural rules, kept for pragmatic reasons:

1. **Resolution helper lives in `src/server/services/`, not `override-resolution.ts`**: Profile resolution requires DB access. The engine layer (`lib/pure/engine/`) is pure functions with no DB. Splitting into two layers adds complexity without proportional benefit at current scale. Revisit if override resolution logic grows beyond ~50 lines.

2. **Zod validation for a profile's active fields is manually defined, not derived from config**: `contribAccountActiveFieldsPatchSchema` / `deductionActiveFieldsSchema` / `salaryEntrySchema` are hand-written rather than derived from the Drizzle schema or `ACCOUNT_TYPE_CONFIG` — derivation adds abstraction with the risk of rejecting valid values if it has bugs, and the hand-written schemas are easy to audit at the current field count. Which fields a profile holds is still read from these schemas, never a hand-kept list (`lib/db/profile-fields.ts`). Revisit if the fields exceed ~25 or change often.

3. **Plans keep the internal name `scenarios`** (table, router, permission key `scenario`): renaming would be a migration plus an RBAC-data change for no user-facing gain. Everything user-facing says "Plan".

---

## Deployment

Live in production (self-hosted Docker). Procedures — deploy, release, rollback, backups — are in [OPS.md](OPS.md).

| Concern          | Implementation                                                                                                                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Image            | 3-stage Dockerfile (deps → builder → runner), digest-pinned `node` Alpine base, Next standalone output                                                                                                                                                                                                       |
| Compose          | `read_only`, `cap_drop: ALL`, `no-new-privileges`, localhost port binding, CPU + memory limits                                                                                                                                                                                                               |
| Health           | `GET /api/health` (status + version); `GET /api/health/detailed` (authenticated: pool, budget API, sync times)                                                                                                                                                                                               |
| Security headers | CSP without `unsafe-eval` (`script-src` allows `unsafe-inline`), HSTS, `X-Frame-Options: DENY`, Permissions-Policy                                                                                                                                                                                           |
| Migrations       | `db-migrate.ts`, bundled with the `src/` modules it imports by esbuild (`pnpm build:migrator`; better-sqlite3 stays external), runs from the entrypoint before the server: pending migrations (with a pre-upgrade backup), then the reference-data seed. Data-converting migrations: § Data Model Principles |
| Monitoring       | Structured JSON logs                                                                                                                                                                                                                                                                                         |

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
contrast on `bg-amber-100` — this applies to
plain status text too, not just filled badges/alerts, so there is only
one canonical shade per color rather than a lighter "text-only" variant:

| Context      | Classes                                                            |
| ------------ | ------------------------------------------------------------------ |
| Error        | `text-red-700`, `bg-red-100 border-red-300`                        |
| Warning      | `text-amber-800`, `bg-amber-100 border-amber-300`                  |
| Success      | `text-green-700`, `bg-green-100 border-green-300`                  |
| Info/link    | `text-blue-700 hover:text-blue-800`, `bg-blue-100 border-blue-300` |
| Danger hover | `hover:text-red-700`                                               |

Consumers include `Badge`, `toast.tsx`, `plan-health.tsx`'s `CalloutLine`
and the status rows on Milestones, Recommendations and Settings.

### Component Catalog

Run `ls src/components/ui/` for the live list (<!-- AUTO-GEN:uiComponents -->36<!-- /AUTO-GEN --> components). Each
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
