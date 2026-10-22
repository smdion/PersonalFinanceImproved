# Engine Module Architecture

The engine is the projection calculator: one pass, year by year, through accumulation (working years) and decumulation (retirement), with per-account tracking, tax estimation and spending strategies. Every module is a pure function with typed inputs and outputs. Rules for changing it: `docs/RULES.md` § Engine Modularity.

## Layout

```
index.ts                     public API (the only entry point)
projection.ts                orchestrator: builds context + state, runs the year loop
projection-year-handlers/    one year of work
  context.ts                 immutable run context (buildProjectionContext)
  state.ts                   mutable run state (buildProjectionState)
  pre-year-setup.ts          return rate, profile switches, spending strategy
  accumulation-year.ts       runAccumulationYear
  decumulation-year.ts       runDecumulationYear
  lump-sum.ts                one-time lump sums (both phases)
  helpers.ts, types.ts
<modules below>              called by the handlers
```

`projection.ts` contains no financial logic — it sets up, loops, and delegates.

## Modules

**Configuration and contributions**

| Module                           | Role                                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `override-resolution.ts`         | Resolves "Changes by year" (sticky-forward) into the year's `ResolvedAccumulationConfig` / `ResolvedDecumulationConfig`. Downstream code only sees resolved config. |
| `contribution-routing.ts`        | Accumulation allocation: waterfall, percentage, or from contribution specs (the production path). IRS limits, caps, tax splits, overflow to a Retirement brokerage. |
| `contribution-projection.ts`     | The one per-spec formula for a year's contribution amount, shared by routing and per-account tracking.                                                              |
| `individual-account-tracking.ts` | Per-account bookkeeping: contributions, match, overflow, withdrawals, goal draws, and `reconcileIndividualToAggregate`.                                             |

**Withdrawals and tax**

| Module                         | Role                                                                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tax-gross-up.ts`              | `estimateWithdrawalTaxCost`: the convergence loop that sizes a withdrawal to cover its own tax (Social Security torpedo, NIIT included), routing it as it goes. |
| `withdrawal-routing.ts`        | Splits a withdrawal across accounts: waterfall, percentage, or bracket filling. Caps, tax preferences, penalty-locked money.                                    |
| `withdrawal-cost-ranking.ts`   | Ranks non-Traditional sources by real cost (basis, penalty) for bracket filling beyond the Traditional cap. Public as `rankWithdrawalTiers`.                    |
| `tax-estimation.ts`            | Bracket tax, effective/marginal rates, taxable Social Security.                                                                                                 |
| `bracket-growth.ts`            | Grows inflation-indexed thresholds (brackets, standard deduction, LTCG, IRMAA) year by year.                                                                    |
| `obbba-senior-deduction.ts`    | The 2025–2028 OBBBA senior deduction and its phase-out.                                                                                                         |
| `rmd-enforcement.ts`           | Required minimum distributions after routing; shortfall spread over Traditional accounts.                                                                       |
| `qcd.ts`                       | Qualified Charitable Distributions that satisfy part of an RMD.                                                                                                 |
| `post-withdrawal-optimizer.ts` | Roth conversions into bracket room, IRMAA and ACA cliff checks.                                                                                                 |
| `rmd-smoothing.ts`             | Sizes Roth conversions to shrink future RMDs toward the spending need.                                                                                          |

**Balances**

| Module                  | Role                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `balance-deduction.ts`  | Deducts withdrawals, clamps negatives, reinvests unspent RMD money, tracks depletion, cleans dust.                           |
| `balance-utils.ts`      | Cloning, bucket ↔ account conversions, `scopedBalances` (retirement vs all-accounts balance), penalty/exclusion subtraction. |
| `brokerage-basis.ts`    | Cost basis per brokerage account (draws, inflows, reconciliation, the Retirement-group ratio) and `syncAggregateBasis`.      |
| `growth-application.ts` | Applies the year's return to every balance structure; basis doesn't grow.                                                    |

**Spending strategies** — `spending-strategy.ts` dispatches by strategy key (`STRATEGY_DISPATCH`); each strategy is its own module, a pure `(params, input) → result`:

| Module                   | Strategy                                                 |
| ------------------------ | -------------------------------------------------------- |
| `guyton-klinger.ts`      | Guardrails with the prosperity rule                      |
| `vanguard-dynamic.ts`    | Base % with a ceiling and floor on year-over-year change |
| `constant-percentage.ts` | Fixed % of the current balance, with a floor             |
| `endowment.ts`           | Fixed % of a rolling average balance, with a floor       |
| `spending-decline.ts`    | Fixed real decline per year                              |
| `forgo-inflation.ts`     | Skip the inflation raise after a losing year             |
| `rmd-spending.ts`        | Spending scaled by the RMD factor                        |

`fixed` is inline in the dispatcher. A new strategy = one module + one dispatch entry. Strategies size spending from the **retirement balance** only.

## One year

**Every year** — `runPreYearSetup`: return rate, profile switches, the spending strategy's target (from the retirement balance), the Portfolio exclusion for the year.

**Accumulation** — `runAccumulationYear`: route contributions (specs, limits, overflow), match, lump sums, goal draws from Portfolio brokerages, growth, then `reconcileIndividualToAggregate` and `syncAggregateBasis`.

**Decumulation** — `runDecumulationYear`, in this order:

1. `resolveDecumulationConfig` — the year's settings
2. `computeQcdAmounts` — charitable distributions against the RMD
3. `estimateWithdrawalTaxCost` — size and route the withdrawal (gross-up)
4. `enforceRmd` — top up to the required minimum
5. per-account distribution, `deductWithdrawals`, `clampBalances`, `reinvestRmdExcess`, `trackDepletions`
6. `computeRmdSmoothingTargets`, `performRothConversion`
7. `checkIrmaa`, `checkAca`
8. `applyGrowth`
9. `cleanupDust`, `reconcileIndividualToAggregate`, `syncAggregateBasis`

The year row then reports `retirementBalance` / `allAccountsBalance`, unmet need and its reasons; `assessPlan` (`../plan-outcome.ts`) judges the run.

## Types

Projection types live in `../types/` (re-exported from `../types.ts`): `ProjectionInput` / `ProjectionResult`, the resolved configs, `TaxBuckets` (aggregate by tax treatment), `AccountBalances` (per category; structure varies by account type), `IndividualAccountInput`, and `EngineYearProjection` (accumulation | decumulation). Module-specific input/result types stay in their module.
