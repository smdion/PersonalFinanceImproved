# Ledgr — Rules & Philosophy

Read all of this: `CLAUDE.md` imports it. How things work is in [DESIGN.md](DESIGN.md), the code conventions in [CONTRIBUTING.md](../CONTRIBUTING.md), the review checklist (§ Violations to Watch For) in [TESTING.md](TESTING.md), and install, deploy and release in [OPS.md](OPS.md).

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

1. **Data-driven.** Behavior that varies lives in config or reference data; code reads it.
2. **Shared logic.** One function per calculation or rule, used by every caller. A second copy is a defect.
3. **One file per piece of logic.** A concept has one obvious home, and that file does one thing.
4. **As simple as possible.** A new abstraction, layer or tool must retire at least two existing copies, or it isn't added. Prefer deleting to adding.
5. **As accurate as possible.** A figure traces to an authority and a derived test. Where simple and accurate conflict, accuracy wins, and the choice is disclosed.

### Review rules

These stop the failure this codebase is most prone to: maintenance by addition, where each change fixes its bug and leaves the shape alone.

1. **Comments state what is true now.** At most three lines of current reason. Past tense, "the fix", counts of bugs and claims like "can't drift" are rejected; history goes in the commit. If a comment needs more, the code or the type changes first. Deleting code deletes its comment.
2. **Change the model, not the branch.** A second fix in the same spot within 30 days first asks what concept is missing. No function over 150 lines may grow. A rename or removal sweeps all callers, aliases and comments.
3. **Types carry the state.** New domain fields use enums and config-derived unions, never `string`. Fields that appear together are grouped into one optional object. A field has one meaning. Identity is an id, never a formatted or display value. A new `as` needs a parser or a one-line reason.
4. **No guards for impossible states.** A default in money code needs a real absent state; a missing key that should exist throws or warns rather than becoming $0.
5. **Data crosses layers as data.** Nothing branches on human-readable text. The engine emits facts and the UI words them. Rendering holds no calculation.

### Product standards

- **Budget apps are equals.** YNAB and Actual Budget are equal citizens: every budget feature, fix and test covers both, whichever one any household uses.
- **SQLite is the default, supported install;** PostgreSQL is equally supported. Neither is "dev only".
- **External responses are parsed, never cast.** A response from another service is checked at the boundary, and a bad shape fails before anything is written.
- **Plan-wide dates show the year,** with each person's age on hover. An age on a plan-wide figure names whose it is. Never average ages for retirement logic. Metrics that are defined on age (income multiples, the wealth formula) keep the household's average age.

## Known Gaps

Rules below state the target. These parts aren't true yet; don't build on them.

- **"One config entry" for an account type.** `AccountCategory` and its enum are hand copies, the default withdrawal order is a hand list (a category missing from it is never drawn), and early access is identity branches.
- **Calculations are answer-keyed only in part.** [CALCULATIONS.md](CALCULATIONS.md) lists every calculation: its Tested column says which rows have hand-worked answer-key cases, and its Gaps column is where calculation bugs are listed. A row with no case has only its pinned tests, which can move with the code. A figure changes only with its source and its cause in dollars.
- **There is no named layer for composition that needs I/O.** It lives in router procedures and `src/server/helpers/`, and some routers call others. Don't add more; a shared service layer is planned.
- **`lib/pure` imports from `@/server/helpers/transforms` and `/settings`.** The rule below allows the first as a stopgap; don't extend it.
- **The `version` permission.** Decided: it manages backups of household data, not access. Today an imported backup can also change logins and access settings.
- **Files and functions over the size rule.** `.size-exempt` isn't a pass to grow.
- **Roth conversions don't add to Roth basis,** until fixed. Conversion basis is decrement-only (`lib/pure/roth-basis-tracking.ts`).
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
- **There are two success bars,** 90% and the report's 85%, until one 90% bar judges every verdict (decision F5, v0.11).

## Data-Driven Architecture

> **Config declares, code executes.** Nothing in the codebase knows what a "401k" is — it only knows how to process an account type with properties like `supportsRothSplit: true` and `balanceStructure: 'roth_traditional'`.

All account-type behavior is defined in `src/lib/config/account-types.ts` (`ACCOUNT_TYPE_CONFIG`). **The target:** adding a new account type = adding one config entry, with no DB migration, enum change or component edits. It isn't true yet: see § Known Gaps.

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

Key files, adding a predicate, and contribution stubs: DESIGN.md § Data-Driven Architecture.

## Pure Business Logic Boundary

**All business logic must live in `src/lib/pure/` — never inside database transactions, API handlers, or router procedures.** This is a hard architectural rule, not a style preference: coupling logic to I/O makes it untestable regardless of database, and a transaction held open across an `await` lets other requests on the one SQLite connection see its uncommitted work.

1. **Pure functions** (`src/lib/pure/`): compute values, validate rules, resolve limits, transform data. No imports from `@/lib/db`, `drizzle-orm`, or any I/O module. Import helpers only from specific submodules (e.g. `@/server/helpers/transforms`), never from barrel re-exports that pull in DB code.
2. **Routers/handlers** (`src/server/routers/`): fetch data, call pure functions, persist results. Thin wrappers only — if you're writing an `if` or a `for` loop that computes a value, it belongs in a pure function.
3. **Tests** (`tests/pure/`): every pure function gets a unit test that runs without any database, network, or environment setup.

**How to tell if logic is in the wrong place:** it's in a `.transaction()` callback; it's in a `protectedProcedure` handler doing math/validation/aggregation; it needs `import * as schema` or `import { eq } from "drizzle-orm"` to work; or it can't be tested without mocking the database.

The short version for contributors is `CONTRIBUTING.md` § Before you write code. This section is the authoritative rule; keep them consistent if either changes.

## The Holistic Rule

> Everything interacts with everything as a holistic plan unless specifically called out as a scenario.

All pages, calculators, and routers share a single, consistent view of the user's financial state. One salary, one budget, one set of contributions, one portfolio — every page reads from the same source.

### Single Computation Path

> For any metric displayed in the app, there must be exactly ONE code path that produces it. If a value can be reached through more than one computation path, those paths WILL eventually diverge — through different inputs, different formulas, different assumptions, or different data freshness. The fix is always the same: one computation, one source, all consumers read from it.

**Test**: Pick any number shown in the UI. Trace it back to its computation. If you find two different code paths that could produce this value (even if they currently give the same answer), that's a bug waiting to happen. Collapse them into one.

Where year-level data, shared state and Salary Profile figures come from: DESIGN.md § The Holistic Rule in practice.

### Rules

1. **No hardcoded fallbacks for user-specific data.** If data doesn't exist, return 0 — don't invent a number. Universal defaults (4% withdrawal rate, IRS limits) are acceptable if stored in DB.
2. **One budget column controls everything.** `budget_active_column` determines which spending level (column) is shown across all pages.
3. **What-ifs are explicit opt-ins.** Sandbox controls (the What-If tab) are clearly labeled as "what-if", never write the active profiles, and never leak into other pages.
4. **Shared helpers, not duplicated queries.** Use `src/server/helpers/` when multiple routers need the same derived value.
5. **Age and personal data come from the `people` table.** Never hardcode ages or personal details.
6. **Grep before reimplementing a documented rule.** Before writing a display rule, derived formula, or label mapping that plausibly already exists (check DESIGN.md and grep for similarly-named components/hooks first), find and reuse the existing implementation rather than writing a second one from the spec. Two independent implementations of the same rule will diverge — this is how the sub-row label rule, tax-type labels, and the household savings-rate formula each shipped real bugs after being written twice.
7. **Year totals come from the year schedule.** One function computes them; every year panel reads it (not true yet: see § Known Gaps).

## Coding Conventions

The rest of the conventions are in CONTRIBUTING.md § Coding Conventions.

- **Comments explain the code, not its history.** A comment should make sense to a developer reading the code cold, with no access to the review session, PR, or roadmap item that produced it. Keep the technical _why_ (a race condition, a real constraint, a non-obvious edge case, a user-reported bug and what actually happened); drop the _citation_ — finding IDs (`H10`, `M42`, `C2`), severity/priority tags (`Critical`, `P0`, `Blocker`), roadmap item numbers (`R32`, `R43`), PR/batch/phase references ("Extracted in PR 8/3a of the v0.5.2 refactor"), bare date-stamps ("found 2026-08-31:", "Decision confirmed 2026-08-19."), and references to plan/review/scratch docs (`PLAN-*.md`, `REVIEW-*.md`, `.scratch/docs/**`) — those docs get renamed and deleted, and the citation rots into a dangling pointer while the comment itself never gets fixed. That context belongs in the commit message, which doesn't rot. A comment that is pure citation with nothing left once the citation is stripped gets deleted outright, not left as an orphaned tag.
  - **Exceptions — these are not provenance, keep them:** references to `docs/RULES.md` / `docs/DESIGN.md` / `docs/TESTING.md` / `docs/OPS.md` (permanent, load-bearing); statutory/tax dates and law versions (`SECURE 2.0 (2023)`, `OBBBA (2025)`, IRS Notice/Rev. Proc. numbers, `tax_year` values); answer-key case ids written as `<area>/<id>` (`ret/R12`, `household/C1`), which name the answer key's cases: each test's title starts with its id, and a closed case is listed by id in its file's header ([TESTING.md](TESTING.md) § Suites worth knowing; a bare `R12` or `(C1)` is still a citation); the `PROJECTION_CACHE_ENGINE_VERSION` per-bump changelog in `projection-cache.ts` (a live, code-dependent version history); `@deprecated` tags describing what to do about the deprecated thing (drop the bare `R##`/finding-ID if one rides along, keep the reasoning); a `v0.8.0 squash` (or similar) constraint that tells a reader "don't remove this dead-but-present column/key yet" — reword to drop the version number if it's not otherwise meaningful, but keep the constraint.
  - **Do keep incident narratives where the story is the documentation** — "found live 2026-08-31: a household that had linked both YNAB and Actual saw their YNAB links vanish while fixing stale Actual links" is not a citation, it's the only record of a real, non-obvious edge case. The test is whether the sentence still means something to a cold reader with the date/tag deleted — if yes, and the remaining prose still explains a genuinely surprising behavior, keep it; if the date/tag was the whole point, cut it.
- **New shared primitives ship with a real consumer.** A component/hook/util introduced specifically to replace duplicated logic (a new `lib/pure/` function, a `lib/hooks/` hook, a `components/ui/` primitive) must migrate at least one genuine call site in the same PR — never merge one with zero adopters "for later." `FormField`, `useOptimisticMutation`, and `safeDivide()` all shipped unused and the duplication they were meant to kill kept spreading for months until a dedicated audit rediscovered them.

### Refactoring: LOC vs per-file size

"Too many lines" is two separate problems with separate fixes — don't conflate them in a refactor plan:

- **Total LOC** is reduced by dead-code sweeps (`knip`), parameterized test compression, and flattening premature abstractions. Realistic ceilings are small (~5% at current size) and often not worth the churn.
- **Per-file size** is the real reviewability problem. Files over ~1,500 lines hurt cognitive load. The fix is splitting into focused modules. Splitting _increases_ total LOC slightly (new imports, prop types) but is the right trade.

"Split large files" does not reduce total LOC. "Delete dead code" does not reduce per-file size. Different problems, different plans.

**Prerequisite for any file split:** add smoke tests for the target file first — mount with mocked tRPC, assert key elements present, one mutation-plumbing test per page. The refactor needs a safety net.

## Time Resolution

> **"Now" is resolved once per request and passed through.** Every function in a request chain must receive its reference date as a parameter — never call `new Date()` independently. Two `new Date()` calls in the same request can disagree on the date, especially at year boundaries.

### Rules

1. **Routers resolve once.** Each tRPC procedure resolves `const asOfDate = new Date()` (or from snapshot date) once at the top. All downstream function calls receive this date as a parameter.
2. **Helpers accept asOfDate.** Functions like `buildYearEndHistory()`, `getEffectiveOtherAssets()`, and `isPriorYearContribWindow()` must accept an `asOfDate` parameter with a `= new Date()` default for backward compatibility. They must never call `new Date()` internally.
3. **Calculator inputs require asOfDate.** All calculator input types already include `asOfDate: Date`. This is enforced by TypeScript — maintain it.
4. **No stray `new Date()` in called functions.** If a function is called from a router that already resolved a date, the function must use the passed date — not create its own.

## Permission & Security Gates

> **Every write path goes through the same permission gate.** If the UI shows a button gated by permission X, the tRPC mutation behind it must use the same permission. Mismatches create confusing UX (visible buttons that fail on click) or security gaps (accessible mutations with no UI check).

### Rules

1. **UI permission must match router procedure.** If a component checks `hasPermission(user, "brokerage")`, the mutation it calls must use `brokerageProcedure` (not `adminProcedure` or `protectedProcedure`). Mismatches in either direction are bugs.
2. **Demo mode blocks all write paths.** The `demoOnlyGuard` middleware blocks tRPC mutations. Non-tRPC API routes (`/api/versions/import`, `/api/versions/export`, etc.) must independently check `process.env.DEMO_ONLY` and return 403 — they bypass tRPC middleware.
3. **No unprotected writes.** Every mutation that modifies _shared application data_ must use a domain-specific procedure (`budgetProcedure`, `performanceProcedure`, etc.) or `adminProcedure`. `protectedProcedure` is for reads only.

   **Exception — session/sandbox mutations.** Mutations in `demo.*` may use `protectedProcedure` because (a) they manage HttpOnly cookie state, not application data, or (b) they write to a demo profile's own schema (one per demo profile, shared by everyone viewing it, seed data only), never to the household's data, and (c) they must remain callable in DEMO_ONLY mode where the `demoOnlyGuard` middleware exempts demo paths. Demo users are not admins, so `adminProcedure` would break the flow. Each such mutation must carry an inline comment justifying the exception.

   **Exception — the first admin.** `settings.createLocalAdmin` is a `publicProcedure` write, because a fresh install has no session yet. Its guard: it runs only while `firstRunState` (`src/server/helpers/first-run.ts`) says an admin is needed, that is, no `local_admins` row exists and onboarding isn't complete, checked again under a transaction lock so two requests can't both create one. Once any admin exists or onboarding is complete it is refused for good. `/login`, the `firstRunState` query and the guard share that one helper; never widen when it is callable. Reset all data, a restore and an import replace the people, settings and local admins, so each ends with `settleFirstRunGate`: `onboarding_completed` becomes true while a way to sign in remains (a local admin, or Authentik), and false otherwise, which reopens the gate as on a fresh install (with a warning in the log) rather than locking the household out.
