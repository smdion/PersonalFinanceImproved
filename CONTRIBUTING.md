# Contributing to Ledgr

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

1. Fork and clone the repo
2. Copy `.env.example` to `.env` and set `NEXTAUTH_SECRET` and `CRON_SECRET` (database defaults to SQLite — no config needed). For the local setup wizard, also set `ALLOW_DEV_MODE=true`
3. Install dependencies: `pnpm install`
4. Run migrations: `pnpm db:migrate`
5. Start dev server: `pnpm dev`

## Making Changes

1. Branch from the current version branch (`vX.Y.Z`), or from `main` for a pull request from a fork: `git checkout -b feature/your-feature`
2. Make your changes
3. Ensure all checks pass:
   ```bash
   pnpm test        # Unit + integration tests
   pnpm lint        # ESLint + Prettier
   pnpm build       # Production build
   pnpm docs:verify # Doc counts and generated docs are current
   ```
4. Submit a pull request

## Code Style

- TypeScript strict mode is enabled
- Format with Prettier (`pnpm format`)
- Lint with ESLint (`pnpm lint`)
- Component files use kebab-case (`my-component.tsx`)
- Database columns use snake_case, TypeScript properties use camelCase

## Before you write code

Read the relevant parts of [`docs/RULES.md`](docs/RULES.md) (the rules), [`docs/DESIGN.md`](docs/DESIGN.md) (how things are built) and [`docs/TESTING.md`](docs/TESTING.md). The ones that matter most:

- **Config declares, code executes.** Account-type behavior comes from `ACCOUNT_TYPE_CONFIG` (`src/lib/config/account-types.ts`) through its helpers — never `if (category === "401k")` or a hardcoded list of categories.
- **Business logic lives in `src/lib/pure/`** (or `src/lib/calculators/` for calculators) — never inside a DB transaction, router procedure or API handler. Routers fetch, call pure functions, and persist. Every pure function gets a unit test in `tests/pure/` with no database.
- **One computation per figure.** Before writing a formula, label map or display rule, look for the existing one and reuse it.
- **Format through the helpers** (`formatCurrency`, `formatPercent`, …) so privacy mode can hide amounts.

### Import discipline for pure modules

Pure modules must not import barrel files that pull in database code — import the submodule directly:

```typescript
// WRONG — the barrel pulls in DB schema
import { toNumber } from "@/server/helpers";

// RIGHT — the pure submodule
import { toNumber } from "@/server/helpers/transforms";
```

See `ls src/lib/pure/` for the existing modules — check there before adding one.

## Commit rules

One behavior per commit, and the message says why. `.husky/commit-msg` and a CI step over a pull request's commits check these with `scripts/check-commit.ts`; for now they only warn.

- **Subject:** a type prefix, `fix:`, `feat:`, `refactor:`, `perf:`, `test:`, `docs:`, `build:`, `ci:`, `chore:`, `style:`, `revert:` or `release:`, with an optional `(scope)`.
- **Body:** why the change is made, not only what changed.
- **Size:** at most 400 changed `src/` lines (generated SQLite files don't count), and at most 8 `src/` files in a commit that touches the engine or tax code (`src/lib/calculators/`, `src/lib/tax-data/`, tax config). A pure move or rename carries a `Mechanical: <what>` line and is exempt.
- **Second fix:** a fix to a function that already had a fix in the last 30 days names the missing concept in a `Concept: <concept>` line, or `Concept: none, <reason>`. A third fix there goes to the advisor first.

`pnpm tsx scripts/check-commit.ts --history 50` reports how the last 50 commits measure against these, repeat fixes in one spot included.

## Coding Conventions

- **Pure calculators.** `lib/calculators/` contains pure functions only — no DB, no tRPC, no React. Given the same inputs, always the same outputs. The engine is a modular subdirectory (`lib/calculators/engine/`) — see DESIGN.md § Engine Modularity.
- **tRPC routers are the bridge.** They fetch from Drizzle, convert decimal strings to numbers via `toNumber()`, call calculators, return results.
- **tRPC verb prefixes:** `get*` — single stored item or current state; `list*` — collection/array result; `compute*` — derived calculation or aggregation. Never use `get*` for procedures that aggregate or compute.
- **Variable naming — no abbreviations.** Use full names: `percent` not `pct`, `amount` not `amt`, `account` not `acct`, `year` not `yr`, `index` not `idx`, `month` not `mo`. Existing abbreviations are migrated incrementally when files are touched for other reasons.
- **Type suffix conventions:** `*Props` for React component props; `*Input` / `*Result` for procedure/calculator I/O types; `*Config` / `*Options` for settings and configuration objects; domain nouns (no suffix) for data shapes (e.g. `DeductionLine`, `BudgetMatch`).
- **Components never import from `server/`, types included.** They consume data via tRPC hooks; a router's result type is `RouterOutputs[...]` from `@/lib/trpc`, never a hand-written copy.
- **Two state layers:** server state (React Query via tRPC) and local component state (`useState`, which also holds form state — no form library).
- **Formatting — zero exceptions.** Use `formatCurrency()`, `formatPercent()`, `compactCurrency()`, `formatDate()` from `@/lib/utils/format`. **Never** inline formatting — this includes chart axis tick formatters, tooltip renderers, and input display formatters. If the canonical function doesn't support your precision needs, extend the function (e.g., `formatPercent(value, decimals)` already accepts a decimals argument) — don't bypass it. Inline `.toFixed(N) + '%'` and `'$${n/1000}k'` are violations. Every dollar amount must go through `formatCurrency()` / `compactCurrency()` — or `maskAmountsInText()` for a sentence the engine or a router already built — so Privacy Mode can hide it (see DESIGN.md § Privacy Mode). A hand-rolled `Intl.NumberFormat` or `$${n.toLocaleString()}` in a component shows the real amount while privacy is on.
- **Colors:** Use centralized helpers from `@/lib/utils/colors.ts` for **every** color that carries meaning — not just account/tax types. This includes chart-series colors, status/severity colors (success/warning/danger/info), and MC-band colors. Two components rendering the same category/status must import the same constant, never re-derive their own hex/Tailwind values inline — this is exactly how the net-worth bar chart and pie chart once showed different colors for the identical category, and how Badge/toast/banner each drifted to a different shade for the same severity.
  - **Account types** (401k, 403b, IRA, HSA, Brokerage): `accountColor()` (bg fill), `accountMatchColor()` (light fill), `accountBorderColor()` (left border), `accountTextColor()` (text)
  - **Tax treatments** (preTax, taxFree, hsa, afterTax): `taxTypeTextColor()` (text for labels/cells), `taxTypeLabel()` (display label); a bar fill reads `TAX_TYPE_COLORS[key].bg`
  - **Status/severity** (success, warning, danger, info): `STATUS_COLORS` — consumed by `Badge`, `toast`, `CalloutLine` and status rows. Do not add a new local shade map for the same 4 semantic colors.
  - **Chart series**: named exports from `colors.ts` (`CHART_COLORS`, `EXPENSE_PIE_COLORS`, `mcBandOuter`/`mcBandInner`/`mcMedian`/etc.) — never a local color array or hardcoded hex per chart file.
  - UI badges (BG, PC, etc.) must NOT use account-type colors — use indigo or gray to avoid overlap.
- **Math:** Use `safeDivide()`, `roundToCents()`, `sumBy()` from `@/lib/utils/math.ts`.
- **Shared components:** `EmptyState`, `HelpTip`, `AccountBadge`, `PageHeader`, `LoadingCard`, `ErrorCard`, `ContribPeriodToggle`.
- **Account type config:** `src/lib/config/account-types.ts` is the single source for all account-type behavior. Use `getAccountTypeConfig()`, `getAllCategories()`, `isOverflowTarget()`, `categoriesWithIrsLimit()`, etc. — never hardcode category checks.
- **Display labels:** Import from `src/lib/config/display-labels.ts`. Never define local label maps in components.

## Mutation Hook Convention

> **Mutation hooks return a flat shape.** tRPC already namespaces mutations under the procedure name; a `{ mutations, invalidate }` wrapper adds indirection without value.

### Rules

1. **Flat return shape.** A mutation hook returns individual named mutators directly: `{ createX, updateX, deleteX, isPending }`. Never `{ mutations: { ... }, invalidate: () => void }`.
2. **Domain-specific naming.** Hook names follow `use<Domain>Mutations` where `<Domain>` is specific enough to be unambiguous globally — `useBudgetItemMutations`, not `useBudgetMutations` (collides with a hypothetical budget-level hook). Integrations hooks that share a domain with a page-level hook must disambiguate: `useBudgetIntegrationsMutations`.
3. **No parent-state callbacks.** Mutation hooks own data — they must not accept callbacks that manage parent UI state (e.g., `onItemCreated: () => setAddingItem(null)`). The caller chains via `.mutateAsync()` or observes `createX.isSuccess`. Keeping UI state in the parent and data mutations in the hook maintains clean separation.

## Constants & Defaults

> **Every numeric default lives in exactly one place.** If a fallback value appears in more than one file, it must be extracted to `src/lib/constants.ts` and imported everywhere. Inline magic numbers are violations — even when they match the constant's current value. A number that can't change, like 12 months in a year, isn't a magic number; write it plainly.

### Rules

1. **One definition per default.** Financial defaults (withdrawal rate, return rate, inflation rate, tax rates) are defined once in `src/lib/constants.ts`. All consumers import from there. No `0.04` or `0.07` scattered across files as fallbacks.
2. **UI threshold constants live in constants.ts too.** Behavioral thresholds (high income threshold, IRMAA start age, etc.) that affect display logic must be centralized, not hardcoded per-component.
3. **DB schema defaults must match code constants.** If a DB column has a `.default("0.04")`, the value must come from the same constant that code fallbacks reference. If the constant changes, both change.
4. **Demo profiles are exceptions.** Demo seed data may use varied values (different inflation rates per profile) — these are intentional per-profile variation, not default definitions.

## Composed Router Convention

> **Any `src/server/routers/<group>/` directory with more than one file MUST have a `_shared.ts` module.** When two or more procedures in the same group use the same Zod schema fragment, enum, or payload-builder helper, that code goes in `_shared.ts` — not copied across procedure files.

### Rules

1. **`_shared.ts` owns intra-group duplication.** Schemas, enums, and helpers used by ≥2 files in a router group (e.g. `sync/`, `projection/`) are extracted to `<group>/_shared.ts` and imported from there. No `serviceEnum` defined in `config.ts` AND `connections.ts` — one source only.
2. **Procedure types within a group must be consistent unless deliberately scoped.** If 4 of 5 mutations in a group use `adminProcedure` and the fifth uses a different type, document why inline — inconsistency is likely a bug, not a design choice.
3. **`_shared.ts` is internal to the group.** It is never imported by files outside `<group>/`. Cross-group sharing goes through `src/server/helpers/` or a new shared module.

## Validation Consistency

> **Every write path to the same table must enforce the same constraints.** If one mutation validates `accountType` with `z.enum()` and another accepts `z.string()`, the second mutation is a hole in the validation layer.

### Rules

1. **Financial amounts use `zDecimal`.** All tRPC mutations that write decimal/currency columns must use the shared `zDecimal` validator from `@/lib/config/enum-values` — never bare `z.string()`. This applies to performance, portfolio, budget, and all other domain mutations.
2. **Account type uses config enum.** Every mutation that accepts `accountType` must use `z.enum(accountCategoryEnum())`. No `z.string().min(1)` on account type fields.
3. **Shared schemas for shared tables.** When multiple mutations write to the same table, extract the field validators into a shared schema or compose from shared field definitions. Don't define independent schemas with different constraints.
4. **Year fields are bounded.** All year inputs should use `z.number().int().min(1900).max(2100)` or similar reasonable bounds — not bare `z.number()`.

## Drizzle ORM Conventions

- **NOT NULL** on every financial amount column unless explicitly nullable
- **Decimal precision:** `decimal(14,2)` for dollars. Rate columns split
  between `decimal(8,6)` and `decimal(12,6)` depending on the table — both
  safely hold values in `[-1,1]`; there is no single documented convention
  to match, so don't infer one from a neighboring column's comment
- **Enums:** enum-like columns are `text` typed with `.$type<T>()` and validated by Zod at the app layer — no `pgEnum`, so adding a value needs no migration
- **JSONB:** Use `.$type<T>()` for type inference
- **ON DELETE:** Default `RESTRICT`; `CASCADE` only for tightly coupled parent-child
- **Indexes:** Explicit indexes on all FK columns (PostgreSQL doesn't auto-create them)

## Sending tax figures

The yearly tax figures (IRS limits, withholding tables, capital-gains and IRMAA brackets, poverty lines) live in `tax-data/us-federal/`, one file a year, and every install picks them up. You don't need the app running to change them:

```sh
pnpm install
pnpm tax-data:new-year 2027   # a new year: every figure blank, to fill in
pnpm tax-data:check           # the same checks CI runs, in seconds
```

Cite the published document for every figure and link it in the year's `sources`; use only published figures, never estimates. `new-year` also writes a blank `tests/fixtures/irs-published/<year>.ts`: key it by hand from the same notices, and CI checks the year's tables against it. Format, conventions and the list of keys: [`tax-data/README.md`](tax-data/README.md).

## Reporting Issues

Open a GitHub issue with:

- Steps to reproduce
- Expected vs actual behavior
- Browser/environment details

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
