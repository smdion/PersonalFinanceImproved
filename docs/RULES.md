# Ledgr — Rules & Philosophy

Read all of this: `CLAUDE.md` imports it. How things work is in [DESIGN.md](DESIGN.md), the code conventions in [CONTRIBUTING.md](../CONTRIBUTING.md), the review checklist (§ Violations to Watch For) in [TESTING.md](TESTING.md), install, deploy and release in [OPS.md](OPS.md), and settled product and architecture choices in [DECISIONS.md](DECISIONS.md).

**Every rule names its guard,** in brackets at its end: `[lint: <rule>]` (ESLint; a ratchet's count lives in the suppression files and only falls), `[test: <file>]`, `[check: <command>]` (a CI script), `[type]` (TypeScript), or `[human]` (a reviewer judges it). A rule with a tool and `[human]` is checked by the tool in the spellings it knows and by review in the rest. Known Gaps are facts, not rules, and name none.

## Core Purpose

A unified financial command center for a household of any shape: one earner or two, any filing status, working or retired. It answers: **"Are we on track?"** across three horizons:

- **This month:** Is the budget funded? Does every dollar have a job?
- **This year:** Are savings goals progressing? Are we maximizing tax-advantaged space?
- **Long-term:** Will we actually be able to retire? Are we in the right tax buckets?

**Primary user:** Admin (daily dashboard scan). Others in the household may check occasionally.

## Rule Scoping

> Rules encode intent, not edge cases. If a rule blocks the right architectural decision, the rule is incomplete — it's missing a boundary condition. Fix the rule, don't work around it or blindly follow it.

Rules that use universal quantifiers ("NEVER", "ALWAYS", "every") without defining their scope will eventually produce wrong decisions at the boundary. When you encounter a conflict between a rule and the right design choice:

1. **Identify the intent** behind the rule — what problem was it preventing?
2. **Identify the scope boundary** — where does the rule's assumption break down?
3. **Update the rule** to document the boundary condition explicitly.
4. **Never silently violate a rule.** Either the rule is wrong and should be updated, or the design choice is wrong and should change. Hidden workarounds compound.

**Example:** "Computed values are NEVER stored" prevents caching stale totals — good intent. But finalized year-end records capture point-in-time state that can't be reconstructed from current data. The rule's assumption (that inputs are always available for recomputation) breaks at the finalization boundary. The fix: update the rule to document the exception, not silently store data in violation.

## Working Standards

These apply to every change, and to every review of one.

1. **Data-driven.** Behavior that varies lives in config or reference data; code reads it. [test: `tests/lint/violations.test.ts`; human]
2. **Shared logic.** One function per calculation or rule, used by every caller. A second copy is a defect. [check: `pnpm check:duplicates`; human]
3. **One file per piece of logic.** A concept has one obvious home, and that file does one thing. [human]
4. **As simple as possible.** A new abstraction, layer or tool must retire at least two existing copies, or it isn't added. Prefer deleting to adding. From the end of v0.12, a feature release also retires something, and its CHANGELOG names it. [human]
5. **As accurate as possible.** A figure traces to an authority and a derived test: a new calculation gets its `docs/CALCULATIONS.md` row, naming the authority, in the same commit. Where simple and accurate conflict, accuracy wins, and the choice is disclosed. [check: `pnpm check:calculation-register`; test: `tests/lint/answer-key.test.ts`; human]

### Review rules

These stop the failure this codebase is most prone to: maintenance by addition, where each change fixes its bug and leaves the shape alone.

1. **Comments explain the code, not its history: they state what is true now.** At most three lines of current reason. Past tense, "the fix", counts of bugs and claims like "can't drift" are rejected; history goes in the commit, incident stories, finding ids (`H10`), owner-question and plan ids (`Q18`, `FQ8`, `D6`), roadmap numbers (`R32`), date-stamps and links to plan or review notes included. If a comment needs more, the code or the type changes first. Deleting code deletes its comment. These are not history, so they stay: statute and tax-law citations (`SECURE 2.0 (2023)`, IRS Notice numbers, `tax_year` values); `@deprecated` tags saying what to do instead; answer-key case ids written `<area>/<id>` (`ret/R12`; [TESTING.md](TESTING.md) § Suites worth knowing; a bare `R12` is a citation); and references to the `docs/` files. [lint: `ratchet/no-history-comment`, `ratchet/max-comment-lines`, `ratchet/no-stacked-docblock`; test: `tests/lint/violations.test.ts`; human: is it true?]
2. **Change the model, not the branch.** A second fix in the same spot within 30 days first asks what concept is missing. No function over 150 lines may grow. A rename or removal sweeps all callers, aliases and comments. [check: `check-commit`'s `Concept:` line, `pnpm check:file-size`, `pnpm check:dead-code`; lint: `max-lines-per-function`; human]
3. **Types carry the state.** New domain fields use enums and config-derived unions, never `string`. Fields that appear together are grouped into one optional object. A field has one meaning. Identity is an id, never a formatted or display value. A new `as` needs a parser or a one-line reason (an `eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- <reason>`). [lint: `ratchet/no-string-closed-set-field`, `@typescript-eslint/consistent-type-assertions`; human]
4. **No guards for impossible states.** A default in money code needs a real absent state; a missing key that should exist throws or warns rather than becoming $0. A fallback that stays is registered by pattern in [FALLBACKS.md](FALLBACKS.md); `ratchet/no-unregistered-fallback` counts new `?? 0`/`|| 0` in money paths, value-returning `catch`es and plaintext-or-encrypted readers. [lint: `@typescript-eslint/no-unnecessary-condition` (`pnpm lint:typed`); human]
5. **Data crosses layers as data.** Nothing branches on human-readable text. The engine emits facts and the UI words them. Rendering holds no calculation. [lint: `ratchet/no-text-includes`; human]

### Product standards

- **Budget apps are equals.** YNAB and Actual Budget are equal citizens: every budget feature, fix and test covers both, whichever one any household uses. [test: `tests/budget-api/client-conformance.test.ts`, `tests/baseline/sync-writes.test.ts`; human]
- **SQLite is the default, supported install;** PostgreSQL is equally supported. Neither is "dev only". [check: CI's SQLite suite and its PostgreSQL job; test: `tests/baseline/router-baseline-postgres.test.ts`]
- **External responses are parsed, never cast.** A response from another service is checked at the boundary, and a bad shape fails before anything is written. [lint: `@typescript-eslint/consistent-type-assertions`; human]
- **Plan-wide dates show the year,** with each person's age on hover. An age on a plan-wide figure names whose it is. Never average ages for retirement logic. Metrics that are defined on age (income multiples, the wealth formula) keep the household's average age. [human]
- **One word per meaning** ([GLOSSARY.md](GLOSSARY.md) § Ledgr terms). **Plan** is a saved set of profiles; **Projection** is the retirement forecast; **Retirement budget** is yearly spending in retirement; **Budget** alone is today's budget. "Retirement spending" and "plan spending" are retired. A profile is "active", never pinned, overridden or customized, and the random-returns run is the "Simulation" (`ratchet/no-retired-ui-word`). Text the user sees changes only in its own commit. [lint: `ratchet/no-retired-ui-word`, `ratchet/no-abbreviation`; human]
- **One bar for the Simulation: 0.90** (`SIMULATION_CONFIDENCE_THRESHOLD`), judging Portfolio Survival only. No second bar (see Known Gaps for the report's 85% until v0.11). [human]

## Known Gaps

Rules below state the target. These parts aren't true yet; don't build on them.

- **"One config entry" for an account type,** until v0.11: some lists and router schemas are still built at module load (the `it.fails` cases in `tests/lint/violations.test.ts`).
- **Early access has two behaviors,** until v0.11: the engine reads each type's `earlyAccessRule`; Tax Buckets still branches on IRA and HSA by name.
- **The engine keys an account by its display name** (with category, tax type and owner), so two same-named accounts of one owner merge (`el-h5`), until it keys by id (v0.11).
- **The W-4 status stands in for the return status** when a year has none, in one function (`w4StandInForReturn`), until the return status is asked for (v0.11).
- **Two MAGI sites keep their own term order,** the ACA check (`aca-check.ts`) and the Roth conversion's IRMAA cap (`roth-conversion.ts`), until `yearMagi` rounds to cents (v0.11).
- **The withdrawal settings' schemas disagree,** until one derives the others (v0.11). Splits sent with a projection or saved in "Changes by year" take any number, while saved settings take 0–1 summing near 100%. Tax-preference keys are any text in the sent defaults but an account category in "Changes by year". `avoidPenalizedWithdrawals` is on both engine types but in no schema, so a sent value is dropped and the default runs.
- **The retirement settings row is listed by hand** in the table, the upsert schema and the client type, until the table is the one source (v0.11). `raisesDuringRetirement` is read by nothing, yet its schema default writes false on every save. `ruleOf55Override` is in the table and the schema, but the engine reads each person's copy (`retirement_profile_people`).
- **Calculations are answer-keyed only in part.** [CALCULATIONS.md](CALCULATIONS.md) lists every calculation: its Tested column says which rows have hand-worked answer-key cases, and its Gaps column is where calculation bugs are listed. A row with no case has only its pinned tests, which can move with the code. A figure changes only with its source and its cause in dollars.
- **Some composition that needs I/O still lives in router procedures,** until it moves into `src/server/services/`: 11 procedures run over 100 lines, the largest the three net-worth reads (`computeSummary`, `listSnapshots`, `computeComparison`; the first and last wait for v0.11's balance-sheet service), and routers hold 52 `.transaction(` calls. No router imports another area's router (`no-router-to-router`). Don't add more.
- **The `version` permission.** Decided: it manages backups of household data, not access. Today an imported backup can also change logins and access settings. A non-admin `version` holder's restore keeps each integration's credentials but takes the backup's account mappings, skipped categories and linked profile and column, until v0.11 keeps today's ones too.
- **Files and functions over the size limit** are recorded in `size-baseline.json`; a recorded size is a ceiling, not a pass to grow.
- **Roth conversions don't add to Roth basis,** until fixed. Conversion basis is decrement-only (`lib/pure/accounts/roth-basis-tracking.ts`).
- **The IRS cap pass doesn't apply 415(c) annual additions or the pay bound,** until fixed. 415(c) is read only for mega-backdoor room.
- **Year totals come from three places** (the schedule, the blended walk, average × checks), until fixed. Only the schedule is right.
- **Over-limit contributions overflow only in some later years,** until they overflow in every year (decision C4, v0.11). Money configured over this year's limit is capped and goes nowhere.
- **RMDs aren't taken before withdrawals start,** until each owner's RMD is taken from their RMD age every year (decision D5, v0.11). A gap year warns; a working year doesn't.
- **A Portfolio-parented Traditional account's RMD isn't taken from it,** until fixed (decision D12.7, v0.11). Its part shows as the owner's RMD shortfall.
- **The projection's end year isn't run** (a Projection to 95 stops at 94), until fixed (decision D10, v0.11).
- **Vanguard Dynamic's ceiling and floor are nominal,** until switched to real, as the paper has them (decision G4, v0.11).
- **The stored stock mean and volatility don't fit one published series** under either reading, until re-sourced (decision F1, v0.11).
- **The Simulation's fixed-return line compounds below the portfolio's median** (a weighted sum of each class's geometric mean), until it uses the portfolio's median rate (decision F2, v0.11).
- **Today's-dollar balances are deflated at their row's start,** up to a year's inflation high, until each balance is deflated by its own date (decision F3, v0.11).
- **Inflation shocks are independent year to year,** so long-run inflation spread is understated, until persistent inflation is modelled (decision F4, v0.11).
- **Missing data still becomes $0 in many money paths** (`?? 0`, `return 0`), listed in [FALLBACKS § Missing money shown as $0](FALLBACKS.md#missing-money-shown-as-0-household-math-work-v011), until each gets a real absent state (§ The Holistic Rule, rule 1). Don't add one.
- **A few older reads compare a UTC day with a local day** (live contributions, the mortgage's payoff check), until v0.11.
- **There are two success bars,** 90% and the report's 85%, until one 90% bar judges every verdict (decision F5, v0.11). The Simulation's colour tones (`simulationRateTone`) also mark 75% amber and colour the stability rates.
- **There are two kinds of calendar day,** the household's local day and SimpleFIN's UTC day (DESIGN § Time Resolution), until one day rules both (v0.11: merging them moves dates). Never compare one with the other.

## Data-Driven Architecture

> **Config declares, code executes.** Nothing in the codebase knows what a "401k" is — it only knows how to process an account type with properties like `supportsRothSplit: true` and `balanceStructure: 'roth_traditional'`.

All account-type behavior is defined in `src/lib/config/account-types.ts` (`ACCOUNT_TYPE_CONFIG`). **The target:** adding a new account type = adding one config entry, with no DB migration, enum change or component edits. It isn't true yet: see § Known Gaps.

### Rules

1. **No category if-chains.** Any code path that branches on account type string must use a config lookup. Direct string comparisons (`=== '401k'`, `.includes('hsa')`) are violations. [test: `tests/lint/violations.test.ts`]
2. **No hand-written list of a closed set.** Use `getAllCategories()` or filtered variants (`categoriesWithIrsLimit()`, `categoriesWithTaxPreference()`). Never write `['401k', '403b', 'hsa', 'ira', 'brokerage']`. The same holds for every set the config defines: filing statuses, portfolio tax types, budget services, dollar bases, pay periods, permissions (`tests/lint/violations.test.ts`; today's few are listed there, shrink-only). A field holding such a value is typed by its set, not `string` (`ratchet/no-string-closed-set-field`). [test: `tests/lint/violations.test.ts`; lint: `ratchet/no-string-closed-set-field`]
3. **Display labels live in config modules.** `src/lib/config/display-labels.ts` and `src/lib/config/account-types.ts` own all label maps. Components import — never define local label maps. Performance category strings (`"401k/IRA"`, `"HSA"`, `"Brokerage"`) must reference exported constants from `display-labels.ts`, not inline string literals. User-visible text kept outside a component lives in `display-labels.ts`, never under `lib/constants`. [test: `tests/lint/violations.test.ts` (performance category strings); human]
4. **Zod validators derive from config.** Use `z.enum(accountCategoryEnum())` — never `z.enum(['401k', ...])`. All mutations that accept `accountType` must use the config-derived enum, including performance account and portfolio account mutations. No `z.string()` for account type fields. [test: `tests/lint/violations.test.ts`]
5. **Balance access uses helpers.** `AccountBalances` is `Record<AccountCategory, AccountBalance>` (discriminated union). Use `getTraditionalBalance()`, `getRothBalance()`, `getTotalBalance()`, `getBasis()` — never literal keys like `accountBalance['401k'].traditional`. [human]
6. **parentCategory checks use predicates.** For an account's stored `parentCategory`, use `isRetirementMoney()` (Retirement or no parent — the projection's scope rule), `isRetirementParent()` / `isPortfolioParent()`; for an account type's default, `isRetirementCategory()`. Never `parentCategory === "Retirement"` or `=== "Portfolio"` directly. The predicate functions are the single source of truth for classification. [test: `tests/lint/violations.test.ts`]
7. **Tax type checks use predicates.** Use `isTaxFree()` and config helpers — never `taxType === "preTax"` or `=== "roth"` directly. This covers any tax key, whatever the variable holding it is called: a tax type, a tax treatment, or an engine key (`preTax`, `taxFree`, `hsa`, `afterTax`), which is canonical but read through helpers, never compared inline. [test: `tests/lint/violations.test.ts`, which knows the name `taxType` only; human]
8. **Display ordering lives in config.** Category tab order, finalize modal sort order, and any other display ordering of account types or performance categories must be defined once in config and imported — never hardcoded as local arrays in components. [human]
9. **Form defaults come from config.** Initial `useState()` values for account type selectors must use `getAllCategories()[0]` or a config-derived default — never `useState("401k")` or other hardcoded category strings. [test: `tests/lint/violations.test.ts`]
10. **Behavior fields, not identity predicates.** Code asks what an account type does (a config field such as `supportsRothSplit` or `irsLimitGroup`, read through its helper), never which type it is: no `isHsaCategory`-style predicate naming an account (`ratchet/no-identity-predicate-import`; only Tax Buckets' four files still import `isHsaCategory`/`isIraCategory`, until v0.11). An account type's label is read through its helper too (`getDisplayConfig(type, subType).displayLabel`), never off the config entry. Inside the engine, dispatch on `balanceStructure` (the shape of the balance) is allowed. [lint: `ratchet/no-identity-predicate-import`, `ratchet/no-config-reach-through`; test: `tests/lint/violations.test.ts` (one config entry adds an account type)]

**`lint-violation-ok`** silences a `tests/lint/violations.test.ts` finder on its line or the three below it, and only with a one-line reason: `// lint-violation-ok: <reason>`. `ratchet/no-lint-violation-ok` counts its uses in `src/`, `tests/` and `scripts/` (owner Q10c): a new one is a `Ratchet-raise:` with its reason. [lint: `ratchet/no-lint-violation-ok`; human]

Key files, adding a behavior field, and contribution stubs: DESIGN.md § Data-Driven Architecture.

## Pure Business Logic Boundary

**All business logic must live in `src/lib/pure/` — never inside database transactions, API handlers, or router procedures.** This is a hard architectural rule, not a style preference: coupling logic to I/O makes it untestable regardless of database, and on SQLite's one connection a transaction held open across an `await` makes every other transaction wait, while plain queries from other requests run inside it and see its uncommitted work.

1. **Pure functions** (`src/lib/pure/<area>/`, one folder per area; the engine is `engine/`): compute values, validate rules, resolve limits, transform data. No imports from `@/lib/db`, `drizzle-orm`, or any I/O module, except `lib/db/shapes/` (types and zod schemas, no I/O), the layer manifest's `shapes`. Never import from barrel re-exports that pull in DB code. [check: `pnpm check:layers`; lint: `no-restricted-imports`]
2. **Routers/handlers** (`src/server/routers/`): fetch data, call pure functions, persist results. Thin wrappers only — if you're writing an `if` or a `for` loop that computes a value, it belongs in a pure function. [human]
3. **Tests** (`tests/pure/<area>/`): every pure function gets a unit test that runs without any database, network, or environment setup. [check: the coverage thresholds; human]
4. **A transaction awaits only the database.** No fetch, file read or other non-database `await` inside a `db.transaction` callback: SQLite runs transactions one at a time, so a slow await holds up every writer. [human]
5. **A read-merge-write of stored JSON is one step.** An app setting changes through `mergeSettingAtomically` (`server/data/settings.ts`); any other JSON value is read and written in one transaction that first takes `lockForTransaction` (`server/data/lock-row.ts`), so a concurrent writer's part isn't lost. [human]
6. **Money in JSON keeps a money column's precision:** whole cents, as `decimal(14,2)` stores it (`roundToCents()` before the write). [human]

**How to tell if logic is in the wrong place:** it's in a `.transaction()` callback; it's in a `protectedProcedure` handler doing math/validation/aggregation; it needs `import * as schema` or `import { eq } from "drizzle-orm"` to work; or it can't be tested without mocking the database.

**Enforced by `pnpm check:layers`** (`.dependency-cruiser.mjs`, run in CI). It holds one layer manifest (foundation, shapes, pure, infrastructure, data, services, routers, server core, sign-in helpers, server pages, UI, worker, scripts) and the import directions between the layers; every `src/server/` and `src/lib/` file must sit in one of its layers (`server-files-in-a-layer`, `lib-files-in-a-layer`), so a new server or lib folder is added to the manifest before it can import anything. Server and pure code never import the UI (`server-never-imports-ui`). Type-only imports count. The engine is reached only through `engine/index.ts`, and its types and input schemas also through `engine/types/index.ts`; relative imports count too. A client module's value import must not reach Zod, directly or through any module it imports (`ui-never-bundles-zod`; type-only imports pass): keep a config file's schemas in a `*.schema.ts` beside it. Today's breaks are listed in `.dependency-cruiser-known-violations.json`, and that list only shrinks: a new break fails with "<from> → <to> breaks layer rule <name>; never add to the known list". When you fix a break, delete its entry in the same commit (`pnpm check:layers --prune`); a stale entry fails.

The short version for contributors is `CONTRIBUTING.md` § Before you write code. This section is the authoritative rule; keep them consistent if either changes.

## The Holistic Rule

> Everything interacts with everything as a holistic plan unless specifically called out as a scenario.

All pages, calculators, and routers share a single, consistent view of the user's financial state. One salary, one budget, one set of contributions, one portfolio — every page reads from the same source.

### Single Computation Path

> For any metric displayed in the app, there must be exactly ONE code path that produces it. If a value can be reached through more than one computation path, those paths WILL eventually diverge — through different inputs, different formulas, different assumptions, or different data freshness. The fix is always the same: one computation, one source, all consumers read from it.

**Test**: Pick any number shown in the UI. Trace it back to its computation. If you find two different code paths that could produce this value (even if they currently give the same answer), that's a bug waiting to happen. Collapse them into one.

Where year-level data, shared state and Salary Profile figures come from: DESIGN.md § The Holistic Rule in practice.

### Rules

1. **Absent is a state, not zero.** Missing data shows as missing, never as $0; 0 only when the data says none. Don't invent a number for user-specific data. Universal defaults (4% withdrawal rate, IRS limits) are acceptable if stored in DB. [human]
2. **Each budget column setting has one use.** `budget_active_column` picks the spending level (column) every page shows for today's budget; the emergency fund (`efund_budget_column`) and the Retirement budget (`retirement_decumulation_budget_column`) each keep their own. A figure that needs a column reads the one for its use; no new column setting is added. [human]
3. **What-ifs are explicit opt-ins.** Sandbox controls (the What-If tab) are clearly labeled as "what-if", never write the active profiles, and never leak into other pages. [human]
4. **Shared reads and services, not duplicated queries.** When multiple routers need the same read or derived value, it lives in `src/server/data/` (a read) or `src/server/services/` (composition). [check: `pnpm check:layers` (`no-router-to-router`); human]
5. **Age and personal data come from the `people` table.** Never hardcode ages or personal details. [human]
6. **Grep before reimplementing a documented rule.** Before writing a display rule, derived formula, or label mapping that plausibly already exists (check DESIGN.md and grep for similarly-named components/hooks first), find and reuse the existing implementation rather than writing a second one from the spec. Two independent implementations of the same rule will diverge — this is how the sub-row label rule, tax-type labels, and the household savings-rate formula each shipped real bugs after being written twice. [check: `pnpm check:duplicates`; human]
7. **Year totals come from the year schedule.** One function computes them; every year panel reads it (not true yet: see § Known Gaps). [human]

## Coding Conventions

The rest of the conventions are in CONTRIBUTING.md § Coding Conventions.

- **New shared primitives ship with a real consumer.** A component/hook/util introduced specifically to replace duplicated logic (a new `lib/pure/` function, a `lib/hooks/` hook, a `components/ui/` primitive) must migrate at least one genuine call site in the same PR — never merge one with zero adopters "for later." `FormField`, `useOptimisticMutation`, and `safeDivide()` all shipped unused and the duplication they were meant to kill kept spreading for months until a dedicated audit rediscovered them. [check: `pnpm check:dead-code`; human]
- **A hook lives in one of three homes, picked by who uses it.** Beside `<route>-content.tsx` when one route uses it, in `components/<feature>/` when one feature shares it, in `lib/hooks/` when two or more features do. No `hooks/` subfolders (`tests/lint/violations.test.ts` holds that list at zero). [test: `tests/lint/violations.test.ts`]
- **A dashboard page is a thin server `page.tsx`** that renders its `<route>-content.tsx` client component (and prefetches through `prefetchForPage()` when it does); no `page.tsx` under `app/(dashboard)` is a client component (`tests/lint/violations.test.ts` holds that list at zero). [test: `tests/lint/violations.test.ts`]
- **The UI's counted patterns each have a primitive** (DESIGN § Layout Patterns), and a count only falls [lint: the rule named on each line; test: `tests/lint/violations.test.ts`]:
  - `ratchet/no-raw-button`: a raw `<button>` → `Button`, where its look matches.
  - `ratchet/no-unlabeled-control`: a control with no accessible name → `FormField`, a `<label htmlFor>` with the control's `id`, or `aria-label`.
  - `ratchet/no-raw-tablist`: a hand-written `role="tab"`, `"tablist"` or `"radiogroup"` → `Tabs` or `SegmentedControl`.
  - `ratchet/no-fixed-inset-overlay`: a hand-built overlay → `Modal` or `Popover`.
  - `ratchet/no-raw-chart-container`: a `ResponsiveContainer` → `ChartFrame`.
  - `ratchet/no-hand-date-format`: `toLocaleDateString`/`toLocaleTimeString` → `formatDate`.
  - `ratchet/no-jsx-iife`: an IIFE in JSX → a named function or a view model.
  - `jsx-a11y/click-events-have-key-events`, `jsx-a11y/no-static-element-interactions`: a click with no keyboard path → `asButton`, `ExpandRowButton`, `SortableHeader` or `CellButton`.
  - A skeleton returned on `isLoading || !data` (`tests/lint/violations.test.ts`, at zero) → `QueryBoundary`.
- **Page budgets have a stated headroom (owner Q15).** `pnpm check:bundle` compares each page's gzipped bytes with its budget in `scripts/check-bundle-size.ts`; a budget is the page's size at the release + 2 KB, rounded up to a whole KB, re-set once per release in one commit with the owner's OK (`pnpm check:bundle --rebase` prints the block). Between re-sets no budget rises: a landing that would pass one stops for the owner. [check: `pnpm check:bundle`, `pnpm check:ratchets`]
- **Names are full words.** No abbreviation from CONTRIBUTING § Coding Conventions' set, plural included, outside the stored, response and external keys `scripts/abbreviation-carve-outs.json` lists; a query's name starts `get`, `list` or `compute`. Today's others are counted and only fall. [lint: `ratchet/no-abbreviation`; test: `tests/lint/procedure-verbs.test.ts`]
- **The UI says the product's words:** "Simulation", never "MC" or "Monte Carlo"; a profile is "active", never pinned, overridden or customized. [lint: `ratchet/no-retired-ui-word`; test: `tests/lint/violations.test.ts`]
- **Every test file runs,** in exactly one vitest project. [test: `tests/lint/vitest-projects.test.ts`]
- **Accessibility violations only fall.** `tests/accessibility/axe-baseline.json` holds each page's axe count per rule. [check: `pnpm check:ratchets`; test: `tests/accessibility/axe.test.tsx`]
- **Copied code only falls.** `pnpm check:duplicates` (CI) runs jscpd (pinned) over `src/` without generated files, tax data and the schema folders, blocks of 100 tokens and up; `scripts/ratchets/duplicates.json` holds its copied blocks and lines. A new pasted copy fails: call the shared code. A cleanup lowers the counts in the same commit (`--update`). [check: `pnpm check:duplicates`]

### Refactoring: LOC vs per-file size

"Too many lines" is two separate problems with separate fixes — don't conflate them in a refactor plan:

- **Total LOC** is reduced by dead-code sweeps (`knip`), parameterized test compression, and flattening premature abstractions. Realistic ceilings are small (~5% at current size) and often not worth the churn.
- **Per-file size.** No file or recorded function grows; a split names a concept per part. `size-baseline.json` records every `src/` file over 400 lines and every function over 150 at its length (`pnpm check:file-size`, CI). Past its recorded size, or past 400 if unrecorded, a file is split, not re-recorded higher. A change that shrinks one lowers its entry in the same commit (`pnpm check:file-size --update`). A move keeps its entries under the new path (`pnpm check:file-size --move <old> <new>`). A move or split may raise size entries by exactly the import lines it adds (a path that now wraps, or a second import source); when code moves into a file that already has an entry, the files the move joins rise together by exactly the import lines added, net across them; a procedure body moved whole into a service function adds its signature (however prettier wraps it), its closing brace and the router's one-line call, a router split its part's `export const … = createTRPCRouter({`/`})` lines and its one mount, and a stage cut from a long function its signature, `return { … }` and brace and the call left in its place, its function held to the lines it took plus those (owner Q14, v0.10.3 Q1), and a UI cut (an IIFE in JSX into a named function, a JSX run into a component; v0.10.4 Q3) its function's lines around what it took, a component's props type, and its call, the lines `check-commit` proves. The lines prettier adds re-wrapping a moved statement that gains `export` pass `check-commit` (v0.10.3 Q23) but are not import lines. A rename is `Mechanical:` when `check-commit` proves it from its `Rename:` list (owner Q2: names only; strings, comments, stored and response keys refused); the lines its re-wrap adds are listed under `Ratchet-raise:`. Each such entry is listed under `Ratchet-raise:` in that commit. Every other raise is its own commit, made only with the owner's OK, with its own `Ratchet-raise:` line (CONTRIBUTING § Commit rules has the format). A split records each new part at its size (`pnpm check:file-size --record <part>… --from <old>`) so parts don't regrow to the limit; the old file's function entries go with them, and a part over 400 is recorded at its size only while the parts together stay within the old entry and the import lines the split adds (`--record --from` counts them, owner Q13). Splitting _increases_ total LOC slightly (new imports, prop types) but is the right trade. [check: `pnpm check:file-size`, `pnpm check:ratchets`, `check-commit`]

"Split large files" does not reduce total LOC. "Delete dead code" does not reduce per-file size. Different problems, different plans.

**Quality ratchet.** Lint counts live in `eslint-suppressions.json` (and `eslint-suppressions-typed.json` for `pnpm lint:typed`): today's cases per file and rule. A count never rises; a cleanup or deletion lowers it in the same commit (`npx eslint <files> --prune-suppressions`; `pnpm lint:typed --prune-suppressions`). Raising a baseline or a count is its own visible commit with the owner's OK; never `--suppress-all`/`--suppress-rule` to pass new code. Division by a value that may be zero uses `safeDivide(n, d, fallback)`; a hand guard (`d > 0 ? n / d : 0` and its spellings) is counted by `ratchet/no-guarded-division`. [check: `pnpm check:ratchets`; lint: `ratchet/no-guarded-division`]

**Prerequisite for any file split:** add smoke tests for the target file first — mount with mocked tRPC, assert key elements present, one mutation-plumbing test per page. The refactor needs a safety net. [human]

## Time Resolution

> **"Now" is resolved once per request and passed through.** Every function in a request chain must receive its reference date as a parameter — never call `new Date()` independently. Two `new Date()` calls in the same request can disagree on the date, especially at year boundaries.

### Rules

1. **Routers resolve once.** The tRPC middleware resolves each call's date once, as `ctx.scope.asOf` and its household day `ctx.scope.today` (`server/trpc.ts`); a procedure may take a selected snapshot's date instead. All downstream function calls receive this date as a parameter. A sync job outside a request reads the clock once at its run's start. [lint: `ratchet/no-clock-read`]
2. **Helpers require asOfDate.** Functions like `buildYearEndHistory()`, `getEffectiveOtherAssets()`, and `isPriorYearContributionWindow()` take `asOfDate` as a required parameter, with no `= new Date()` default: a default guards a state that shouldn't exist. They never call `new Date()` internally. [lint: `ratchet/no-clock-read`; type]
3. **Calculator inputs require asOfDate.** All calculator input types already include `asOfDate: Date`. This is enforced by TypeScript — maintain it. [type]
4. **No stray `new Date()` in called functions.** If a function is called from a router that already resolved a date, the function must use the passed date — not create its own. [lint: `ratchet/no-clock-read`]
5. **After a fetch.** A step that means now, after a network fetch, may read the clock again, with a one-line comment. [human; `ratchet/no-clock-read` counts the read]
6. **Write stamps.** When something happened (a row's `updatedAt`, a cache entry's expiry, a log line) reads `writeStamp()` (`lib/utils/clock.ts`), never a business date. `ratchet/no-clock-read` counts every other clock read in `src/server` and `src/lib`. [lint: `ratchet/no-clock-read`; human]

## Permission & Security Gates

> **Every write path goes through the same permission gate.** If the UI shows a button gated by permission X, the tRPC mutation behind it must use the same permission. Mismatches create confusing UX (visible buttons that fail on click) or security gaps (accessible mutations with no UI check).

### Rules

1. **UI permission must match router procedure.** If a component checks `hasPermission(user, "brokerage")`, the mutation it calls must use `brokerageProcedure` (not `adminProcedure` or `protectedProcedure`). Mismatches in either direction are bugs. [human]
2. **Demo mode blocks all write paths.** The `demoOnlyGuard` middleware blocks tRPC mutations. Non-tRPC API routes (`/api/versions/import`, `/api/versions/export`, etc.) must independently check `process.env.DEMO_ONLY` and return 403 — they bypass tRPC middleware. [test: `tests/lint/violations.test.ts` (API routes), `tests/routers/demo-postgres.test.ts`]
3. **No unprotected writes.** Every mutation that modifies _shared application data_ must use a domain-specific procedure (`budgetProcedure`, `performanceProcedure`, etc.) or `adminProcedure`. `protectedProcedure` is for reads only. [human]

   **Exception — session/sandbox mutations.** Mutations in `demo.*` may use `protectedProcedure` because (a) they manage HttpOnly cookie state, not application data, or (b) they write to a demo profile's own schema (one per demo profile, shared by everyone viewing it, seed data only), never to the household's data, and (c) they must remain callable in DEMO_ONLY mode where the `demoOnlyGuard` middleware exempts demo paths. Demo users are not admins, so `adminProcedure` would break the flow. Each such mutation must carry an inline comment justifying the exception. [human]

   **Exception — the household's own bookkeeping and Plans.** `milestones.recordReached` records the milestones the active profiles reach: it is the app's bookkeeping, so any signed-in viewer's visit may record, and a demo never does. `settings.scenarios.activate` applies a Plan, and `applyPlan` refuses it unless the viewer holds the permission for every profile it changes. Both are `protectedProcedure`. [test: `tests/routers/milestones.test.ts`, `tests/routers/plans.test.ts`]

   **Exception — the first admin.** `settings.createLocalAdmin` is a `publicProcedure` write, because a fresh install has no session yet. Its guard: it runs only while `firstRunState` (`src/server/data/first-run.ts`) says an admin is needed, that is, no `local_admins` row exists and onboarding isn't complete, checked again under a transaction lock so two requests can't both create one. Once any admin exists or onboarding is complete it is refused for good. `/login`, the `getFirstRunState` query and the guard share that one helper; never widen when it is callable. Reset all data, a restore and an import replace the people, settings and local admins, so each ends with `settleFirstRunGate`: `onboarding_completed` becomes true while a way to sign in remains (a local admin, or Authentik), and false otherwise, which reopens the gate as on a fresh install (with a warning in the log) rather than locking the household out. [test: `tests/routers/fresh-install-cases.ts`]
