# Contributing to Ledgr

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

1. Fork and clone the repo
2. Copy `.env.example` to `.env` and set `NEXTAUTH_SECRET` and `CRON_SECRET` (database defaults to SQLite — no config needed). Set `ENCRYPTION_KEY` too (`openssl rand -base64 32`) to save an integration's credentials. For the local setup wizard, also set `ALLOW_DEV_MODE=true`
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
- `saxes` is pinned exactly (no caret): it parses SEC's XML filings, outside input, and releases rarely, so a new version comes only as a reviewed Dependabot pull request; watch it for that pull request and for a `pnpm audit` advisory

## Before you write code

Read the relevant parts of [`docs/RULES.md`](docs/RULES.md) (the rules), [`docs/DESIGN.md`](docs/DESIGN.md) (how things are built) and [`docs/TESTING.md`](docs/TESTING.md). The ones that matter most:

- **Config declares, code executes.** Account-type behavior comes from `ACCOUNT_TYPE_CONFIG` (`src/lib/config/account-types.ts`) through its helpers — never `if (category === "401k")` or a hardcoded list of categories.
- **Business logic lives in `src/lib/pure/`** — never inside a DB transaction, router procedure or API handler. Routers read through `src/server/data/`, compose in `src/server/services/<area>/` when the work needs I/O or is shared, call pure functions, and persist. Every pure function gets a unit test in `tests/pure/<area>/` with no database.
- **One computation per figure.** Before writing a formula, label map or display rule, look for the existing one and reuse it.
- **Format through the helpers** (`formatCurrency`, `formatPercent`, …) so privacy mode can hide amounts.

### Import discipline for pure modules

Pure modules import nothing from `src/server/` or the database (`pnpm check:layers` fails it); a small helper they share with the server lives in `src/lib/utils/`:

```typescript
// WRONG — server code; it pulls in DB schema
import { getAllPeople } from "@/server/data/people";

// RIGHT — the shared utility
import { toNumber } from "@/lib/utils/numbers";
```

`src/lib/pure/` has one folder per area (`accounts`, `advice`, `budget`, `contributions`, `debts`, `household`, `investments`, `net-worth`, `paycheck`, `retirement`, `savings`, `simulation`, `sync`, `tax`; the projection engine in `engine/`). Check the area's folder before adding a module, and add a new one there, with its I/O types in a `*.types.ts` beside it, never flat in `lib/pure/`. Small helpers with no domain (dates, formatting, math) live in `src/lib/utils/`.

## Commit rules

One behavior per commit, and the message says why. `.husky/commit-msg` and a CI step over every commit since the merge base with `main` (on pushes and pull requests) check these with `scripts/check-commit.ts --strict`, and a breach blocks (since v0.10.1).

- **Subject:** a type prefix, `fix:`, `feat:`, `refactor:`, `perf:`, `test:`, `docs:`, `build:`, `ci:`, `chore:`, `style:`, `revert:` or `release:`, with an optional `(scope)`.
- **Body:** why the change is made, not only what changed.
- **Revert:** a `revert:` (or git's `Revert "…"`) commit says why in its own words; git's "This reverts commit …" line alone fails.
- **Size:** at most 400 changed `src/` lines (generated SQLite files don't count), and at most 8 `src/` files in a commit that touches the engine or tax code (`src/lib/pure/engine/`, `src/lib/pure/tax/`, `src/lib/pure/paycheck/`, `src/lib/pure/contributions/irs-limits.ts`, `src/lib/tax-data/`, tax config). A pure move, rename or split carries a `Mechanical: <what>` line and is exempt; the line is accepted only when git sees a rename (`git show -M`) or code moved between files, and every other changed line is an import (a line inside an `import` or `export … from` statement), a path rewrite, or a line moved unchanged in the same commit; moved code goes in whole top-level statements, each run in its old order (a leading `export` may be added, and a statement prettier then re-wraps is compared token by token: nothing but `export` added, its comments the same; a move, split or cut may take its comments along, and reword a moved comment, or write a new part's or function's doc comment, within RULES' three-line limit (owner v0.10.4 Q3: at most three new or reworded lines in a comment block, each new block rewording one the move took away or documenting a part or function it made, the comments inside moved code each kept or reworded, none added; a longer rewording goes in its own commit)), or as an arrow or function expression's whole body moved unchanged into a new top-level function, the expression replaced by an arrow that only calls it with its own parameters, or as whole router procedures, in their old order, into a new part (`export const x = createTRPCRouter({…})` mounted as `key: x`, or `export const x = {…}` spread as `...x`, in the literal they left), or as a stage: contiguous top-level statements of one function (or of a callback passed straight to a call inside one, its captured names passed in as parameters, none of them reassigned there), in order, into a new top-level function (in that file or another) that adds only its signature and a `return { … }` of the names the rest of the function reads, called where they were with the function's own names (`const { a, b } = stage(x, y);`; a stage may not assign a name it is passed, return from the function, or leave a name the rest reads behind), or as a UI cut (owner v0.10.4 Q3): an immediately-invoked arrow inside JSX whose body moves unchanged into a new top-level function called in its place with the names it captures as parameters (none of them reassigned there), or a contiguous run of JSX children moved unchanged into a new top-level component (its one `return`, a fragment around several children, a props type right above it) rendered in its place as `<Part a={a} />`, exactly the names it reads as same-named props; either is refused when it calls a hook or moves an element with a `key`. A split's parts are recorded under the split size rule (RULES § Refactoring).
- **Proven renames (owner Q2):** a `Mechanical:` commit with `Rename: <old> → <new>[, …]` is accepted when every changed code line is its old line with those names renamed, token by token (prettier's re-wrap allowed), and nothing else changes but the register's code references and the ratchet files; a comment may change only by those names (each name kept or renamed, nothing else in it changed: W6 (a)); strings (except one that names a property in a type: the index of `T["key"]`, a `Pick`/`Omit` key), stored, external and response keys (`scripts/gen-abbreviation-carve-outs.ts` reads them), a router's object keys and `z.object` keys are refused, and the commit moves, creates or deletes no file. A size entry the re-wrap raises is listed under `Ratchet-raise:`.
- **Comments-only (owner V6):** a commit that changes only comments in `src/` carries a `Comments-only: <what>` line and is exempt from the Size limits; the line is accepted only when every changed `src/` file is code whose tokens, read as the engine hash reads them (`codeOf` in `scripts/engine-hash.ts`: comments and layout aside, line breaks between tokens kept), are unchanged, and no `src/` file is created, deleted or moved.
- **`Visible:`** (since v0.10.4): a commit body says `Visible: none`, or lists exactly what a user will see change (a focus ring or order, a keyboard path, screen-reader-only text, a failure state, a dialog's backdrop or layer, a note, a figure). The release's CHANGELOG and its smoke-test checklist are built from these lines.
- **UI cuts:** an IIFE in JSX into a named function, or a run of JSX into a component, is a move (the Size rule above): `check-commit` proves it, and refuses one that moves a hook call into a child or an element with a `key`. A moved comment may be reworded or dropped; only its changed lines count toward the three, each function or file the cut creates may bring one short doc comment, and any other added comment is refused.
- **Figure commits (v0.11 G1):** a commit that changes or removes lines of a pinned figure (`tests/baseline/__baseline__/`, `__sync__/`, `__text__/`, `__screens__/`, the engine and Simulation snapshots, an answer-key file: `tests/**/answer-key*.test.ts` or `tests/fixtures/answer-key*.ts`, or a pinned expected-rows fixture `tests/fixtures/*-rows.json`) carries `Baseline-rerecord: <glob> — <item id>, <reason>` (the Ratchets bullet's form, its reason starting with the scope item's id, e.g. `TX5`), a `Figure-change: <case or field>: $A → $B, <cause>` line per moved figure class, and `scripts/baseline-diff.ts`'s count line (`N figure(s) moved in M baseline file(s) since <rev>.`) in the body. One that moves no figure (a wording re-record, a comment in the answer key) says `Baseline-rerecord: <glob> — none, <reason>`. A new pin, file or case only adds lines and needs none.
- **Second fix:** a fix to a function that already had a fix in the last 30 days names the missing concept in a `Concept: <concept>` line, or `Concept: none, <reason>`. A third fix there goes to the advisor first, and its pass is recorded in an `Advisor: PASS (round <n>)` line.
- **Ratchets:** CI compares every ratchet (`size-baseline.json`, both suppressions files, the calculation-register baseline and its risk labels, page budgets, coverage thresholds, the known lists in `tests/lint/violations.test.ts`) and the behavior baseline (`tests/baseline/__baseline__/`, `__sync__/`, `__text__/`) with the merge base: `pnpm check:ratchets --base "$(git merge-base origin/main HEAD)"`. A move or split hands the old counts to its parts and passes. It may raise size entries by exactly the import lines it adds; when code moves into a file that already has an entry, the files the move joins rise together by exactly the import lines added, net across them (in a `Mechanical:` commit CI counts the import lines); a body moved whole into a service function adds its signature, closing brace and one-line call, a router split its part's wrapper lines and mount, a stage its signature, return, brace and call (owner Q14 and v0.10.3 Q1: CI cuts the moves `check-commit` finds and counts what is left, in code lines). Every other raise is its own commit, made only with the owner's OK (CI checks the line, not the OK). Each commit that raises an entry names it, with the rise, in its own `Ratchet-raise: <ratchet file> — <entry> +<N>[; <entry> +<N>…], <reason>` line, one line per ratchet file; CI checks every commit against its parent, so a line in another commit excuses nothing. The entry is the `src/` path for a size entry (the path then the function's name for a function's entry), the path and rule for a lint count, `<path>:<export>` for the register, the route for a page budget, the key for a coverage threshold or a known list; `+N` is at least the rise (`<a> → <b>` also reads as the rise), and text in parentheses is reason. For example `Ratchet-raise: size-baseline.json — src/server/routers/performance.ts +2, a second import source`. A known-list entry whose key changes and nothing else (the declaration it names is renamed or its file moves) is not a raise: that commit names it in `Known-renamed: <ratchet file> — <path> <oldName> => <path> <newName>`, which CI accepts only when the old key goes and the new one comes in that commit, on the same path or that path's rename in it, with the same count, and nothing else in that list rises. A revert may put an entry back to its value before the commit it reverts. CI prints every excused rise. A re-recorded baseline file needs `Baseline-rerecord: <glob> — <reason>`. Deleting a baseline file passes.

`pnpm tsx scripts/check-commit.ts --history 50` reports how the last 50 commits measure against these, repeat fixes in one spot included.

## Coding Conventions

- **Pure logic.** `lib/pure/` contains pure functions only — no DB, no tRPC, no React. Given the same inputs, always the same outputs. The engine is a modular subdirectory (`lib/pure/engine/`) — see DESIGN.md § Engine Modularity.
- **Routers parse, call and return.** A procedure parses its input, calls a read in `server/data/`, a service in `server/services/` or a pure function, and returns the result; decimal strings become numbers through `toNumber()`. No router imports another router (`pnpm check:layers`).
- **tRPC verb prefixes:** `get*` — single stored item or current state; `list*` — collection/array result; `compute*` — derived calculation or aggregation. Never use `get*` for procedures that aggregate or compute. `tests/lint/procedure-verbs.test.ts` holds today's other names, a list that only shrinks.
- **Procedure doc comments:** every query, and every mutation that does more than its name says (a side effect, a guard that refuses, a result beyond an ack), has a one-line doc comment; `docs/API_ROUTERS.md` prints it as the Description. `tests/lint/procedure-doc-comments.test.ts` holds the count of procedures without one to `scripts/ratchets/undocumented-procedures.json`, which only falls (`check:ratchets`), lowered in the commit that documents.
- **Variable naming — no abbreviations** (owner Q7, v0.10.5). Use full words: `percent` not `pct`, `amount` not `amt`, `account` not `acct`, `year` not `yr`, `index` not `idx`, `month` not `mo`, `contribution` not `contrib`, `balance` not `bal`, `simulation` not `mc`, `decumulation` not `dec`, `withdrawal` not `wd`, `inflation` not `infl`, `allocation` not `alloc`, `calculation` not `calc`, `projection` not `proj`, `salary` not `sal`, `estimate` not `est`, `annual` not `ann`; and (owner W8, counted since v0.10.6, renamed in v0.11) `individual` not `ind`, `performance` not `perf`, `category` not `cat`, `brokerage` not `brok`, `decumulation` not `decum`, `accumulation` not `accum`, `retirement` not `ret` (`return` spelled out where it means return). A plural counts (`pcts`), and so does a word inside a longer name (`retAgeMcPct`). `ratchet/no-abbreviation` counts today's names, and the count only falls. Carved out: stored and schema keys, router response keys, browser-storage values and external API fields, listed in `scripts/abbreviation-carve-outs.json` (`scripts/gen-abbreviation-carve-outs.ts` writes it): renaming one changes a shape. A rename sweep is a `Mechanical:` commit with a `Rename: <old> → <new>` list that `check-commit` proves (§ Commit rules, Proven renames).
- **Type suffix conventions:** `*Props` for React component props; `*Input` / `*Result` for procedure/calculator I/O types; `*Config` / `*Options` for settings and configuration objects; domain nouns (no suffix) for data shapes (e.g. `DeductionLine`, `BudgetMatch`).
- **Components never import from `server/`, types included.** They consume data via tRPC hooks; a router's result type is `RouterOutputs[...]` from `@/lib/trpc`, never a hand-written copy.
- **Two state layers:** server state (React Query via tRPC) and local component state (`useState`, which also holds form state — no form library).
- **Formatting — zero exceptions.** Use `formatCurrency()`, `formatPercent()`, `compactCurrency()`, `formatDate()` from `@/lib/utils/format`. **Never** inline formatting — this includes chart axis tick formatters, tooltip renderers, and input display formatters. If the canonical function doesn't support your precision needs, extend the function (e.g., `formatPercent(value, decimals)` already accepts a decimals argument) — don't bypass it. Inline `.toFixed(N) + '%'` and `'$${n/1000}k'` are violations. Every dollar amount must go through `formatCurrency()` / `compactCurrency()` — or `maskAmountsInText()` for a sentence the engine or a router already built — so Privacy Mode can hide it (see DESIGN.md § Privacy Mode). A hand-rolled `Intl.NumberFormat` or `$${n.toLocaleString()}` in a component shows the real amount while privacy is on.
- **Colors:** Use centralized helpers from `@/lib/utils/colors.ts` for **every** color that carries meaning — not just account/tax types. This includes chart-series colors, status/severity colors (success/warning/danger/info), and MC-band colors. Two components rendering the same category/status must import the same constant, never re-derive their own hex/Tailwind values inline — this is exactly how the net-worth bar chart and pie chart once showed different colors for the identical category, and how Badge/toast/banner each drifted to a different shade for the same severity.
  - **Account types** (401k, 403b, IRA, HSA, Brokerage): `accountColor()` (bg fill), `accountMatchColor()` (light fill), `accountBorderColor()` (left border), `accountTextColor()` (text)
  - **Tax treatments** (preTax, taxFree, hsa, afterTax): `taxTypeTextColor()` (text for labels/cells), `taxTypeLabel()` (display label, in `lib/config/display-labels.ts` beside `TAX_TYPE_LABELS`); a bar fill reads `TAX_TYPE_COLORS[key].bg`
  - **Status/severity** (success, warning, danger, info): `STATUS_COLORS` — consumed by `Badge`, `toast`, `CalloutLine` and status rows. Do not add a new local shade map for the same 4 semantic colors.
  - **Chart series**: named exports from `colors.ts` (`CHART_COLORS`, `EXPENSE_PIE_COLORS`, `mcBandOuter`/`mcBandInner`/`mcMedian`/etc.) — never a local color array or hardcoded hex per chart file.
  - UI badges (BG, PC, etc.) must NOT use account-type colors — use indigo or gray to avoid overlap.
- **Math:** Use `safeDivide()`, `roundToCents()`, `sumBy()` from `@/lib/utils/math.ts`.
- **Shared components:** `EmptyState`, `HelpTip`, `AccountBadge`, `PageHeader`, `QueryBoundary` (a card's: `CardQueryBoundary`), `Modal`, `Popover`, `Tabs`, `SegmentedControl`, `ChartFrame`, `ContribPeriodToggle`; the full list, and the lint rule that counts each pattern they replace, is DESIGN § Layout Patterns.
- **Account type config:** `src/lib/config/account-types.ts` is the single source for all account-type behavior. Use `getAccountTypeConfig()`, `getAllCategories()`, `isOverflowTarget()`, `categoriesWithIrsLimit()`, etc. — never hardcode category checks.
- **Display labels:** Import from `src/lib/config/display-labels.ts`. Never define local label maps in components.

## Mutation Hook Convention

> **Mutation hooks return a flat shape.** tRPC already namespaces mutations under the procedure name; a `{ mutations, invalidate }` wrapper adds indirection without value.

### Rules

1. **Flat return shape.** A mutation hook returns individual named mutators directly: `{ createX, updateX, deleteX, isPending }`. Never `{ mutations: { ... }, invalidate: () => void }`.
2. **Domain-specific naming.** Hook names follow `use<Domain>Mutations` where `<Domain>` is specific enough to be unambiguous globally — `useBudgetItemMutations`, not `useBudgetMutations` (collides with a hypothetical budget-level hook). Integrations hooks that share a domain with a page-level hook must disambiguate: `useIntegrationBudgetMutations`.
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
3. **`_shared.ts` is internal to the group.** It is never imported by files outside `<group>/`. Cross-group sharing goes through `src/server/data/` (a shared read) or `src/server/services/` (shared composition).

## Validation Consistency

> **Every write path to the same table must enforce the same constraints.** If one mutation validates `accountType` with `z.enum()` and another accepts `z.string()`, the second mutation is a hole in the validation layer.

### Rules

1. **Financial amounts use `zDecimal`.** All tRPC mutations that write decimal/currency columns must use the shared `zDecimal` validator from `@/lib/utils/zod-fields` — never bare `z.string()`. This applies to performance, portfolio, budget, and all other domain mutations.
2. **Account type uses config enum.** Every mutation that accepts `accountType` must use `z.enum(accountCategoryEnum())`. No `z.string().min(1)` on account type fields.
3. **Shared schemas for shared tables.** When multiple mutations write to the same table, extract the field validators into a shared schema or compose from shared field definitions. Don't define independent schemas with different constraints.
4. **Year fields are bounded.** All year inputs should use `z.number().int().min(1900).max(2100)` or similar reasonable bounds — not bare `z.number()`.

## Drizzle ORM Conventions

- **NOT NULL** on every financial amount column unless explicitly nullable
- **Decimal precision:** `decimal(14,2)` for dollars. Rate columns split
  between `decimal(8,6)` and `decimal(12,6)` depending on the table — both
  safely hold values in `[-1,1]`; there is no single documented convention
  to match, so don't infer one from a neighboring column's comment
- **Schema workflow:** the PostgreSQL tables in `src/lib/db/pg/*.ts` are the source (a new domain file gets an `export *` line in `schema-pg.ts`). After an edit, `pnpm db:generate` writes the migration and `npx tsx scripts/gen-sqlite-schema.ts` regenerates `src/lib/db/sqlite/` and `schema-sqlite.ts`; never edit those by hand.
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
