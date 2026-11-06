# Test Suite

```bash
pnpm test             # unit + integration (Vitest), benchmarks excluded
pnpm test:benchmarks  # engine vs published research (slower)
pnpm test:coverage    # with coverage report (coverage/)
pnpm test:stress      # property tests at 200 runs
pnpm test:e2e         # Playwright (needs a running app; PLAYWRIGHT_BASE_URL to override :3000)
pnpm vitest run tests/pure/engine   # one area — prefer this while working
```

**<!-- AUTO-GEN:vitestFiles -->654<!-- /AUTO-GEN --> Vitest files** + **<!-- AUTO-GEN:e2eFiles -->16<!-- /AUTO-GEN --> Playwright specs** (counts checked by `pnpm docs:verify`). Tests mirror the source layout; to see what covers a module, look in the matching `tests/` folder.

## Suites

| Folder                                         | What it tests                                                                                                                                                                                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pure/<area>/`, `pure/engine/`                 | `src/lib/pure/` business logic, no DB, no network (RULES.md § Pure Business Logic Boundary): every calculator and the engine; unit tests, snapshot fixtures, property-based invariants, retirement-scope invariance, spending strategies |
| `benchmarks/`                                  | The engine against Trinity Study, cFIREsim, asset-class assumptions, glide paths, tax accuracy (own Vitest project)                                                                                                                      |
| `routers/`                                     | tRPC procedures called directly against an isolated SQLite DB, incl. permission enforcement                                                                                                                                              |
| `baseline/`                                    | Behavior baseline (v0.10.x): every router query's numbers for 17 invented households, SQLite and PostgreSQL, and the rows sync writes                                                                                                    |
| `helpers/`                                     | Tests of shared server reads and services (`src/server/data/`, `src/server/services/`) and some `lib/pure/` modules, from before they had their own folders; new ones go under `server/` or `pure/<area>/`                               |
| `components/`, `hooks/`, `accessibility/`      | UI behavior (Testing Library), hooks (`renderHook`), axe-core checks                                                                                                                                                                     |
| `config/`                                      | Account-type config, IRS limits, RMD tables, tax-data freshness and completeness                                                                                                                                                         |
| `db/`                                          | Schema, migrations, dialect parity, backup transforms, reference data                                                                                                                                                                    |
| `integration/`                                 | Zod schemas, backup round-trip through the real version logic                                                                                                                                                                            |
| `lint/`                                        | RULES.md sweeps over the source (hardcoded categories, tax tables outside config, re-declared constants, theme, …)                                                                                                                       |
| `budget-api/`, `simplefin/`, `sec/`, `tiingo/` | External clients and sync logic                                                                                                                                                                                                          |
| `server/`, `utils/`, `scripts/`, `edge-cases/` | Auth callbacks, utilities, repo scripts, extreme inputs                                                                                                                                                                                  |
| `e2e/`                                         | Playwright smoke tests and the privacy-mode leak scan                                                                                                                                                                                    |

**Coverage** is scoped to `src/server/**` and, under `src/lib/`, `config`, `budget-api`, `db`, `pure`, `simplefin`, `env.ts` and four named `utils` files (`vitest.config.ts`). Components, hooks, `tax-data`, `auth`, `sec` and `tiingo` aren't measured; thresholds in `vitest.config.ts`: statements 85%, branches 70%, functions 80%, lines 85%.

## Suites worth knowing

- **`pure/engine/engine-snapshot.test.ts`** — ~70 fixtures; each pins key figures (`toBe`) and a metrics snapshot. A failure reads "sustainable withdrawal changed from X to Y". Every fixture must have consistent starting money (see below).
- **`pure/engine/engine-invariants.test.ts`** — property-based ([fast-check](https://github.com/dubzzz/fast-check)): balance conservation, limits never exceeded, phases never reverse, non-negative tax, generated inputs consistent with themselves. 20 runs by default; `FAST_CHECK_NUM_RUNS` for more.
- **`pure/retirement/retirement-scope-invariance.test.ts`** — adding $1M of Portfolio money (or saving into it) changes no retirement answer.
- **`lint/violations.test.ts`** — the RULES.md sweeps; numbered rules in its header.
- **`**/answer-key-*.test.ts`** — the answer key: figures worked by hand from the published rules, each with its derivation and source beside it, titled `<area>/<id> [CALCULATIONS row]`; [CALCULATIONS.md](CALCULATIONS.md)'s Tested column counts them per row (`pnpm docs:update`). Helpers in `fixtures/answer-key.ts` (`cents`, `ledgerRow`, `xfail`, `runOneYear`). An expected failure is `it.fails` naming the release and TODO item that fix it (`v0.11 …`), with today's figure pinned beside it; `lint/answer-key.test.ts` enforces the naming and unique ids. `lint/calculations-law-year.test.ts` fails when a newer tax year ships than CALCULATIONS' tax-law rows were checked for, or a shipped year lacks a whole-return case for a filing status.
- **`baseline/router-baseline.test.ts`** — the v0.10.x behavior baseline: each household seeded through the write procedures, every query called with the clock fixed, its numbers (never text) compared with `baseline/__baseline__/`; `sync-writes.test.ts` pins the rows a replayed YNAB or Actual sync writes (`baseline/__sync__/`). A structural commit leaves those files byte-identical (the rule is in the test's header); `LEDGR_BASELINE_WRITE=1` rewrites them only when a deleted procedure's files go.
- **`e2e/privacy-mode.spec.ts`** — every route with the privacy cookie set must show no `$<digit>`; server HTML must carry no amounts.
- **`e2e/first-run.spec.ts`** — a fresh install signs in: the first local admin is created on /login and the onboarding wizard runs to Done, no `DEMO_ONLY`. Runs only inside `scripts/ci-image-boot.sh` (CI pushes), against the real image booted from each sample compose file on an empty volume.

## Fixtures and harnesses

| File                                  | Provides                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pure/fixtures/engine-fixtures.ts`    | `makeTaxBuckets`, `makeAccountBalances`, config factories; **`withConsistentStart`** (keeps buckets and per-category balances in step when a test sets one) and **`startingBalanceGaps`** (asserted empty by the engine suites — a fixture whose money disagrees with itself changes depletion) |
| `pure/fixtures.ts`                    | Synthetic household (Person A $120k, Person B $110k): brackets, contribution specs, paycheck inputs                                                                                                                                                                                             |
| `benchmarks/benchmark-helpers.ts`     | `makeStandardInput`, `makeTrinityInput`, `makePureGrowthInput`, `makeMCInput`, asset classes, correlations, glide paths, tolerances                                                                                                                                                             |
| `benchmarks/history-replay.ts`        | `replayGrid()`: the simulation spec § 11.6 30-year grid replayed through the engine from `cfiresim-export.csv` (answer key K15 and the behavior baseline in `behavior-baseline-replay-grid.ts`)                                                                                                 |
| `routers/setup.ts` + `setup-mocks.ts` | `createTestCaller()` — isolated SQLite DB with migrations and seed; `adminSession`, `viewerSession`, `createViewerSessionWithPermissions([...])`; seed helpers (`seedStandardDataset`, …)                                                                                                       |
| `fixtures/`                           | Milestone and profile fixtures shared across suites                                                                                                                                                                                                                                             |

Fixtures use invented data only — never a real household's figures.

## Patterns

- **Snapshot** — engine, Monte Carlo and brokerage-goal outputs; `roundDeep()` removes float noise.
- **Property-based** — invariants for any valid input.
- **Benchmark** — published research within stated tolerances.
- **Router integration** — call procedures directly; check permission gates with viewer sessions.
- **Lint-as-test** — source sweeps enforce RULES.md.
- **E2E smoke** — pages load and navigate. In CI they run against a standalone build with SQLite, `DEMO_ONLY=true` and an empty database; locally against a real database some checks (privacy scan, YNAB card) depend on the data.
- **PostgreSQL** — CI's `postgres` job (a PostgreSQL 16 service) migrates the empty database (`pnpm db:migrate`), checks its primary keys, foreign keys and indexes against `scripts/constraints/<dialect>.txt` on both dialects (`pnpm check:constraints`; `--write` rewrites the list when a migration changes one on purpose), then runs the files that need PostgreSQL, each in its own named step: `routers/demo-postgres.test.ts` (a demo profile and data calls through the real middleware; demo schemas exist only on PostgreSQL; `DEMO_ONLY=true`), `routers/fresh-install-postgres.test.ts`, and `routers/seeded-postgres.test.ts` (each demo household seeded into `public`: every page's main read, a transaction, and the backup round trip through `scripts/export-backup.ts` and `scripts/import-backup.ts`). They share `routers/setup-postgres.ts` and run only when `TEST_DATABASE_URL` names a throwaway database ending in `_test` (they drop its schemas); elsewhere they skip.

## Updating snapshots

When engine output changes on purpose:

```bash
pnpm vitest run tests/pure/engine/engine-snapshot.test.ts -u
```

The pinned `toBe` figures don't update with `-u` — change them from the failure messages. Review the snapshot diff and explain the change in the commit.

## Violations to Watch For

- A router computing budget expenses with a different column index
- A page showing salary/pay-schedule/W-4 data that doesn't come from a
  Salary Profile entry via `resolveCompensation()` /
  `mergeSalaryProfileJobFields()` (profile-aware) — `jobs` has no such
  columns left to read
- A pinned salary being treated as excluding bonus, or total compensation
  computed anywhere other than `resolveCompensation()`
- Any field of `SalaryEntry` reappearing in a Contribution Profile
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
- A `{ MFJ: <figure>, Single: <figure>, HOH: <figure> }` tax-figure table (rates, thresholds, bracket data) declared outside `src/lib/config/` instead of imported from a config module (`tests/lint/violations.test.ts` rule 23)
- A local `const` re-declaring an ALL_CAPS name already exported from `src/lib/constants.ts` or a `src/lib/config/` module, instead of importing it (rule 24)
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
- A plan-wide date shown as an age, or an unnamed or averaged age on a plan-wide figure
- An external response cast with `as` instead of parsed at the boundary
- A budget feature, fix or test that covers only one of YNAB and Actual
