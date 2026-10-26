# Test Suite

```bash
pnpm test             # unit + integration (Vitest), benchmarks excluded
pnpm test:benchmarks  # engine vs published research (slower)
pnpm test:coverage    # with coverage report (coverage/)
pnpm test:stress      # property tests at 200 runs
pnpm test:e2e         # Playwright (needs a running app; PLAYWRIGHT_BASE_URL to override :3000)
pnpm vitest run tests/calculators   # one area — prefer this while working
```

**<!-- AUTO-GEN:vitestFiles -->453<!-- /AUTO-GEN --> Vitest files** + **<!-- AUTO-GEN:e2eFiles -->15<!-- /AUTO-GEN --> Playwright specs** (counts checked by `pnpm docs:verify`). Tests mirror the source layout; to see what covers a module, look in the matching `tests/` folder.

## Suites

| Folder                                         | What it tests                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `calculators/`                                 | Every calculator and the engine: unit tests, snapshot fixtures, property-based invariants, retirement-scope invariance, spending strategies |
| `benchmarks/`                                  | The engine against Trinity Study, cFIREsim, asset-class assumptions, glide paths, tax accuracy (own Vitest project)                         |
| `pure/`                                        | `src/lib/pure/` business logic — no DB, no network (RULES.md § Pure Business Logic Boundary)                                                |
| `routers/`                                     | tRPC procedures called directly against an isolated SQLite DB, incl. permission enforcement                                                 |
| `helpers/`                                     | `src/server/helpers/`                                                                                                                       |
| `components/`, `hooks/`, `accessibility/`      | UI behavior (Testing Library), hooks (`renderHook`), axe-core checks                                                                        |
| `config/`                                      | Account-type config, IRS limits, RMD tables, tax-data freshness and completeness                                                            |
| `db/`                                          | Schema, migrations, dialect parity, backup transforms, reference data                                                                       |
| `integration/`                                 | Zod schemas, backup round-trip through the real version logic                                                                               |
| `lint/`                                        | RULES.md sweeps over the source (hardcoded categories, tax tables outside config, re-declared constants, theme, …)                          |
| `budget-api/`, `simplefin/`, `sec/`, `tiingo/` | External clients and sync logic                                                                                                             |
| `server/`, `utils/`, `scripts/`, `edge-cases/` | Auth callbacks, utilities, repo scripts, extreme inputs                                                                                     |
| `e2e/`                                         | Playwright smoke tests and the privacy-mode leak scan                                                                                       |

**Coverage** is scoped to `src/lib/calculators/**` and `src/server/**`; thresholds in `vitest.config.ts`: statements 85%, branches 70%, functions 80%, lines 85%.

## Suites worth knowing

- **`calculators/engine-snapshot.test.ts`** — ~70 fixtures; each pins key figures (`toBe`) and a metrics snapshot. A failure reads "sustainable withdrawal changed from X to Y". Every fixture must have consistent starting money (see below).
- **`calculators/engine-invariants.test.ts`** — property-based ([fast-check](https://github.com/dubzzz/fast-check)): balance conservation, limits never exceeded, phases never reverse, non-negative tax, generated inputs consistent with themselves. 20 runs by default; `FAST_CHECK_NUM_RUNS` for more.
- **`calculators/retirement-scope-invariance.test.ts`** — adding $1M of Portfolio money (or saving into it) changes no retirement answer.
- **`lint/violations.test.ts`** — the RULES.md sweeps; numbered rules in its header.
- **`e2e/privacy-mode.spec.ts`** — every route with the privacy cookie set must show no `$<digit>`; server HTML must carry no amounts.

## Fixtures and harnesses

| File                                      | Provides                                                                                                                                                                                                                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calculators/fixtures/engine-fixtures.ts` | `makeTaxBuckets`, `makeAccountBalances`, config factories; **`withConsistentStart`** (keeps buckets and per-category balances in step when a test sets one) and **`startingBalanceGaps`** (asserted empty by the engine suites — a fixture whose money disagrees with itself changes depletion) |
| `calculators/fixtures.ts`                 | Synthetic household (Person A $120k, Person B $110k): brackets, contribution specs, paycheck inputs                                                                                                                                                                                             |
| `benchmarks/benchmark-helpers.ts`         | `makeStandardInput`, `makeTrinityInput`, `makePureGrowthInput`, `makeMCInput`, asset classes, correlations, glide paths, tolerances                                                                                                                                                             |
| `routers/setup.ts` + `setup-mocks.ts`     | `createTestCaller()` — isolated SQLite DB with migrations and seed; `adminSession`, `viewerSession`, `createViewerSessionWithPermissions([...])`; seed helpers (`seedStandardDataset`, …)                                                                                                       |
| `fixtures/`                               | Milestone and profile fixtures shared across suites                                                                                                                                                                                                                                             |

Fixtures use invented data only — never a real household's figures.

## Patterns

- **Snapshot** — engine, Monte Carlo and brokerage-goal outputs; `roundDeep()` removes float noise.
- **Property-based** — invariants for any valid input.
- **Benchmark** — published research within stated tolerances.
- **Router integration** — call procedures directly; check permission gates with viewer sessions.
- **Lint-as-test** — source sweeps enforce RULES.md.
- **E2E smoke** — pages load and navigate. In CI they run against a standalone build with SQLite, `DEMO_ONLY=true` and an empty database; locally against a real database some checks (privacy scan, YNAB card) depend on the data.

## Updating snapshots

When engine output changes on purpose:

```bash
pnpm vitest run tests/calculators/engine-snapshot.test.ts -u
```

The pinned `toBe` figures don't update with `-u` — change them from the failure messages. Review the snapshot diff and explain the change in the commit.
