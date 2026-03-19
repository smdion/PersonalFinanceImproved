# Engine Module Architecture

The engine is the core projection calculator. It runs a single-pass year-by-year
simulation covering both accumulation (pre-retirement contributions) and
decumulation (post-retirement withdrawals), producing a full financial projection
with per-account tracking, tax estimation, and spending strategy adjustments.

## Module Dependency Graph

```
                         index.ts
                            |
                            | re-exports public API
                            v
                      projection.ts  (orchestrator)
                       /  |  |  |  \  \  \  \  \
                      /   |  |  |   \  \  \  \  \
                     v    v  v  v    v  v  v  v  v
  override-resolution.ts  |  |  |    |  |  |  |  |
  contribution-routing.ts |  |  |    |  |  |  |  |
  withdrawal-routing.ts --+  |  |    |  |  |  |  |
  tax-estimation.ts ------+--+  |    |  |  |  |  |
  rmd-enforcement.ts             |    |  |  |  |  |
  post-withdrawal-optimizer.ts --+    |  |  |  |  |
  spending-strategy.ts (dispatcher)   |  |  |  |  |
  growth-application.ts              |  |  |  |  |
  individual-account-tracking.ts     |  |  |  |  |
  balance-deduction.ts               |  |  |  |  |
  balance-utils.ts                   |  |  |  |  |


Cross-module dependencies (beyond projection.ts):

  withdrawal-routing.ts -----> tax-estimation.ts
  post-withdrawal-optimizer.ts -> tax-estimation.ts
  balance-deduction.ts ------> individual-account-tracking.ts (IndKeyFn type)

  spending-strategy.ts ------> forgo-inflation.ts
                                spending-decline.ts
                                constant-percentage.ts
                                endowment.ts
                                vanguard-dynamic.ts
                                rmd-spending.ts
                                guyton-klinger.ts
```

## Module Responsibilities

| Module                             | Role                                                                                                                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **projection.ts**                  | Orchestrator. Runs the year-by-year loop, wires all modules together. Exports `calculateProjection` and `calculateContributionEngine`.                                                                                       |
| **index.ts**                       | Barrel file. Re-exports the public API so consumers import from `engine/`.                                                                                                                                                   |
| **override-resolution.ts**         | Resolves per-year sticky-forward overrides into `ResolvedAccumulationConfig` / `ResolvedDecumulationConfig`. Called once per year; all downstream modules receive resolved config, never raw overrides.                      |
| **contribution-routing.ts**        | Accumulation-phase allocation. Three modes: `routeWaterfall`, `routePercentage`, `routeFromSpecs` (DB-driven, dominant production path). Handles IRS limits, account caps, tax splits, overflow to brokerage.                |
| **withdrawal-routing.ts**          | Decumulation-phase withdrawal distribution. Three modes: `routeWithdrawals` (waterfall), `routeWithdrawalsPercentage`, `routeWithdrawalsBracketFilling` (tax-optimal). Handles account caps, tax-type caps, tax preferences. |
| **tax-estimation.ts**              | Tax bracket estimation, SS taxation (IRS provisional income formula), and gross-up convergence loop. Resolves the circular dependency between taxable SS and Traditional withdrawal estimates.                               |
| **rmd-enforcement.ts**             | Enforces IRS Required Minimum Distribution after withdrawal routing. Distributes shortfall proportionally across Traditional accounts. Applies to all routing modes.                                                         |
| **post-withdrawal-optimizer.ts**   | Roth conversions (fill remaining bracket room), IRMAA cliff checks (Medicare surcharge, age 65+), ACA subsidy cliff checks (pre-65 retirees). Runs after withdrawal routing + RMD, before growth.                            |
| **spending-strategy.ts**           | Dispatcher mapping strategy keys to engine functions. Defines the `SpendingStrategyInput/Result` interface and cross-year state shape.                                                                                       |
| **growth-application.ts**          | Applies return rate to all balance structures (TaxBuckets + AccountBalances). Preserves cost basis (brokerage basis does not grow).                                                                                          |
| **individual-account-tracking.ts** | Per-account bookkeeping. Routes contributions, employer match, overflow, and withdrawals to individual accounts within each category. Maintains running balances via composite-keyed `indBal` map.                           |
| **balance-deduction.ts**           | Mechanical balance operations: withdrawal deduction from tax buckets/accounts, negative-balance clamping, RMD excess reinvestment, depletion tracking, dust cleanup.                                                         |
| **balance-utils.ts**               | Helpers for cloning `AccountBalances` and deriving them from `TaxBuckets`.                                                                                                                                                   |

### Spending Strategy Modules

Seven strategy implementations, each a pure function `(params, input) -> SpendingStrategyResult`:

| Module                     | Strategy                   | Notes                                                            |
| -------------------------- | -------------------------- | ---------------------------------------------------------------- |
| **forgo-inflation.ts**     | Forgo Inflation After Loss | Skip inflation adjustment after negative return year. SWR 4.4%.  |
| **spending-decline.ts**    | Spending Decline           | Fixed annual real decline rate. SWR 5.0%.                        |
| **constant-percentage.ts** | Constant Percentage        | Fixed % of current portfolio, with floor. SWR 5.7%.              |
| **endowment.ts**           | Endowment                  | Fixed % of N-year rolling average balance, with floor. SWR 5.7%. |
| **vanguard-dynamic.ts**    | Vanguard Dynamic           | Base % with ceiling/floor on YoY spending changes. SWR 4.7%.     |
| **rmd-spending.ts**        | RMD-Based Spending         | Withdrawal scaled by IRS RMD factor. SWR 5.4%.                   |
| **guyton-klinger.ts**      | Guyton-Klinger             | Upper/lower guardrails with prosperity rule.                     |

## Orchestrator Pattern

`projection.ts` is the hub. It owns the year-by-year loop and calls extracted
modules in pipeline order. No extracted module calls back into the orchestrator.
The pipeline for each decumulation year is roughly:

1. `resolveDecumulationConfig` -- resolve overrides for this year
2. `applySpendingStrategy` -- adjust spending target
3. `estimateWithdrawalTaxCost` -- SS convergence + gross-up
4. `routeWithdrawals*` -- distribute withdrawals across accounts
5. `enforceRmd` -- enforce minimum distributions
6. `deductWithdrawals` -- subtract from balances
7. `performRothConversion` -- fill bracket room
8. `checkIrmaa` / `checkAca` -- cliff awareness
9. `reinvestRmdExcess` -- reinvest forced excess
10. `applyGrowth` -- investment returns
11. `clampBalances` / `cleanupDust` -- balance hygiene
12. `trackDepletions` -- record account depletions

Accumulation years follow a simpler variant: resolve config, route contributions,
apply employer match, apply growth.

## Spending Strategy Dispatcher Pattern

`spending-strategy.ts` acts as a fan-out dispatcher. It defines:

- The common `SpendingStrategyInput` / `SpendingStrategyResult` interfaces
- `SpendingCrossYearState` (orchestrator-owned, passed in each year)
- Per-strategy typed param interfaces (`GuytonKlingerStrategyParams`, etc.)
- `STRATEGY_DISPATCH` record mapping `WithdrawalStrategyType` keys to functions
- `applySpendingStrategy()` as the single entry point

Adding a new strategy = one new engine file + one case in `STRATEGY_DISPATCH`.
The `fixed` strategy is inlined (identity function). All others import from
their dedicated module.

## Key Types

All projection types are defined in `../types.ts` (one level up). Key ones:

- `ProjectionInput` / `ProjectionResult` -- top-level API contract
- `ResolvedAccumulationConfig` / `ResolvedDecumulationConfig` -- resolved per-year config
- `AccumulationSlot` / `DecumulationSlot` -- per-account routing results
- `TaxBuckets` -- aggregate balance by tax treatment (preTax, taxFree, hsa, afterTax)
- `AccountBalances` -- per-category balances (structure varies: roth_traditional, single_bucket, basis_tracking)
- `AccountCategory` -- union of account categories (from `config/account-types`)
- `EngineYearProjection` -- discriminated union of accumulation/decumulation year output

Types defined within engine modules:

- `tax-estimation.ts`: `WithholdingBracket`, `TaxEstimationInput`, `TaxEstimationResult`
- `spending-strategy.ts`: `SpendingStrategyInput`, `SpendingStrategyResult`, `SpendingCrossYearState`, `StrategyParamsMap`, all per-strategy param interfaces
- `rmd-enforcement.ts`: `RmdEnforcementInput`, `RmdEnforcementResult`
- `post-withdrawal-optimizer.ts`: `RothConversionInput/Result`, `IrmaaInput/Result`, `AcaInput/Result`
- `growth-application.ts`: `GrowthInput`
- `balance-deduction.ts`: `DeductWithdrawalsInput`
- `individual-account-tracking.ts`: `IndKeyFn`, `DistributeContributionsInput/Result`

## tax-estimation.ts: Most Depended-Upon Module

`tax-estimation.ts` is imported by three other engine modules, making it the
most interconnected module in the engine:

1. **projection.ts** -- uses all four exports (`estimateEffectiveTaxRate`, `incomeCapForMarginalRate`, `computeTaxableSS`, `estimateWithdrawalTaxCost`)
2. **withdrawal-routing.ts** -- uses `incomeCapForMarginalRate` + `WithholdingBracket` type for bracket-filling mode
3. **post-withdrawal-optimizer.ts** -- uses `estimateEffectiveTaxRate` + `incomeCapForMarginalRate` + `WithholdingBracket` for Roth conversion tax cost calculation

It also contains the SS convergence loop (`estimateWithdrawalTaxCost`) which
resolves the circular dependency between taxable SS and Traditional withdrawal
estimates -- one of the more complex algorithms in the engine.
