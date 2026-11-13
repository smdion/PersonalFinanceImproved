# Engine Module Architecture

The engine is the projection calculator: one pass, year by year, through accumulation (working years) and decumulation (retirement), with per-account tracking, tax estimation and spending strategies. Every module is a pure function with typed inputs and outputs. Rules for changing it: `docs/DESIGN.md` § Engine Modularity.

## Layout

```
index.ts                     public API (the only entry point)
projection.ts                orchestrator: builds context + state, runs the year loop
input-validation.ts          validateEngineInputs: balance checks, rate clamps, setup warnings
opening-state.ts             declareOpeningParts: every account part a flow can target, at the start
projection-year-handlers/    one year of work
  context.ts                 immutable run context (buildProjectionContext)
  state.ts                   mutable run state (buildProjectionState)
  pre-year-setup.ts          return rate, profile switches, spending strategy; the year's phase (UD-02) and the first retirement year's spending (UD-01)
  contribution-target.ts     a working year's year-0 basis, contribution target and employer match
  contribution-slots.ts      the IRS limits per slot, then the slots routed
  rate-ceiling.ts            the retirement-rate ceiling on the spec slots
  contribution-credits.ts    the totals and overflow, the credits to the balances, the per-account spread
  goal-draws.ts              a gap year's draw and the brokerage goal draws
  year-end-accounts.ts       the per-account rows, reconcile and the year-end balances
  accumulation-year.ts       runAccumulationYear
  decumulation-year.ts       runDecumulationYear: calls the stages below in order
  decumulation-income.ts     the year's income before any draw: each owner's RMD
  rmd-step.ts                the QCD, then each RMD enforced on the routed draw (UD-04)
  year-tax-tables.ts         the year's tax tables, each grown from its own table year
  year-deduction.ts          the year's standard deduction, grown, with the senior add-ons
  year-need.ts               the after-tax need and the withdrawal that meets it
  year-draws.ts              the draw routed by mode, then followed to each account
  tax-settlement.ts          settleYearTax: the tax-settlement stage over the two files below
  tax-year-settlement.ts     the tax priced and settled in today's order (UD-04, UD-08)
  conversion-year-reprice.ts the conversion year's gains re-priced, then NIIT
  funding-shortfall.ts       the unmet need (raw) and whether it's material
  year-cliffs.ts             IRMAA and ACA cliff checks
  portfolio-contributions.ts Portfolio contributions after retirement, reported only
  year-end.ts                growth, year-end state, account rows, reconciliation
  decumulation-row.ts        the decumulation year's row, from what its stages settled
  lump-sum.ts                one-time lump sums (both phases)
  stated-need.ts             the first decumulation year's stated need
  helpers.ts, types.ts
individual-accounts/         the per-account ledger: ledger, contributions, withdrawals, reconcile
withdrawal-routing/          one year's withdrawal by mode: waterfall, percentage, bracket filling
spending-strategies/         the eight spending strategies, each (params, input) → result
<modules below>              called by the handlers
```

`projection.ts` contains no financial logic — it sets up, loops, and delegates.

## Modules

**Configuration and contributions**

| Module                                 | Role                                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `override-resolution.ts`               | Resolves "Changes by year" (sticky-forward) into the year's `ResolvedAccumulationConfig` / `ResolvedDecumulationConfig`. Downstream code only sees resolved config. |
| `contribution-routing.ts`              | Accumulation allocation: waterfall, percentage, or from contribution specs (the production path). IRS limits, caps, tax splits, overflow to a Retirement brokerage. |
| `contribution-projection.ts`           | The one per-spec formula for a year's contribution amount, shared by routing and per-account tracking.                                                              |
| `individual-accounts/ledger.ts`        | The per-account ledger: account keys, `credit`, a year's growth and tracked Roth basis.                                                                             |
| `individual-accounts/contributions.ts` | Contributions, match, overflow and ramp spread to each account; specs matched to their accounts.                                                                    |
| `individual-accounts/withdrawals.ts`   | Withdrawals and brokerage goal draws spread to each account.                                                                                                        |
| `individual-accounts/reconcile.ts`     | Year end per account: each account's row, clamps, and `reconcileIndividualToAggregate`.                                                                             |

**Withdrawals and tax**

| Module                                       | Role                                                                                                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `withdrawal-solver.ts`                       | `estimateWithdrawalTaxCost`: the convergence loop that sizes a withdrawal to cover its own tax (Social Security torpedo, NIIT included), routing it as it goes; `met`, or `capped` with its shortfall.             |
| `withdrawal-routing/index.ts`                | `routeForMode`: one year's withdrawal to the mode's router, with the Roth-bracket overlay and the last-resort allowance.                                                                                           |
| `withdrawal-routing/waterfall.ts`            | Waterfall: accounts drained in the household's order, with caps and tax preferences.                                                                                                                               |
| `withdrawal-routing/percentage.ts`           | Percentage: a fixed share per account; a short account's shortfall spreads to the rest.                                                                                                                            |
| `withdrawal-routing/bracket-filling.ts`      | Bracket filling: Traditional up to the target bracket, then the rest ranked by real cost.                                                                                                                          |
| `withdrawal-routing/roth-bracket-overlay.ts` | The Roth-bracket overlay on a waterfall config: Traditional capped at the target bracket.                                                                                                                          |
| `withdrawal-routing/caps.ts`                 | The bracket cap on Traditional, the household's caps left after a pass, and the past-target warning.                                                                                                               |
| `withdrawal-routing/types.ts`                | `RouteBracketInfo` (the year's brackets for routing) and `RouteResult` (what every mode returns).                                                                                                                  |
| `withdrawal-cost-ranking.ts`                 | Ranks non-Traditional sources by real cost (basis, penalty) for bracket filling beyond the Traditional cap. Public as `rankWithdrawalTiers`.                                                                       |
| `tax-estimation.ts`                          | Bracket tax, effective/marginal rates, taxable Social Security.                                                                                                                                                    |
| `inflation-path.ts`                          | The inflation a run sees year by year: one object every compounding site reads, shocked per year in a Simulation trial.                                                                                            |
| `price-level.ts`                             | `projectionPriceLevel`: a run's price level by calendar year, on that path, for today's dollars outside the loop (Coast FIRE).                                                                                     |
| `bracket-growth.ts`                          | Grows inflation-indexed thresholds (brackets, standard deduction, LTCG, IRMAA) year by year.                                                                                                                       |
| `return-deductions.ts`                       | In `lib/pure/tax/`: the 2025–2028 OBBBA senior deduction and its phase-out; last year's MAGI is known or unknown.                                                                                                  |
| `rmd-enforcement.ts`                         | Required minimum distributions after routing. Multi-person households: each owner's RMD is pinned to that owner's accounts, including owner assignment; single-person: shortfall spread over Traditional accounts. |
| `social-security-income.ts`                  | Social Security paid in a year, per person; one computation for the year handler and strategies.                                                                                                                   |
| `qcd.ts`                                     | Qualified Charitable Distributions that satisfy part of an RMD.                                                                                                                                                    |
| `roth-conversion.ts`                         | Roth conversions into bracket room; the tax is paid from brokerage.                                                                                                                                                |
| `conversion-irmaa-cap.ts`                    | A conversion's room under the next IRMAA cliff above the year's MAGI.                                                                                                                                              |
| `irmaa-check.ts`                             | The IRMAA cliff check: surcharge cost, and a warning when a conversion crosses a cliff.                                                                                                                            |
| `aca-check.ts`                               | The ACA subsidy cliff check: MAGI headroom under 400% FPL, and a warning past it.                                                                                                                                  |
| `household-irmaa.ts`                         | The household IRMAA surcharge: per-person cost × people 65+, for both decumulation-year sites.                                                                                                                     |
| `rmd-smoothing.ts`                           | Sizes Roth conversions to shrink future RMDs toward the spending need.                                                                                                                                             |

**Balances**

| Module                  | Role                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `balance-deduction.ts`  | Deducts withdrawals, clamps negatives, reinvests unspent RMD money, tracks depletion, cleans dust.                           |
| `balance-utils.ts`      | Cloning, bucket ↔ account conversions, `scopedBalances` (retirement vs all-accounts balance), penalty/exclusion subtraction. |
| `brokerage-basis.ts`    | Cost basis per brokerage account (draws, inflows, reconciliation, the Retirement-group ratio) and `syncAggregateBasis`.      |
| `growth-application.ts` | Applies the year's return to every balance structure; basis doesn't grow.                                                    |

**Spending strategies** — `spending-strategy.ts` dispatches by strategy key (`STRATEGY_DISPATCH`); each strategy is its own module in `spending-strategies/`, a pure `(params, input) → result`, and their shared types are `types/spending-strategy.ts`:

| Module                                       | Strategy                                                 |
| -------------------------------------------- | -------------------------------------------------------- |
| `spending-strategies/guyton-klinger.ts`      | Guardrails with the withdrawal and prosperity rules      |
| `spending-strategies/vanguard-dynamic.ts`    | Base % with a ceiling and floor on year-over-year change |
| `spending-strategies/constant-percentage.ts` | Fixed % of the current balance, with a floor             |
| `spending-strategies/endowment.ts`           | Fixed % of a rolling average balance, with a floor       |
| `spending-strategies/spending-decline.ts`    | Fixed real decline per year                              |
| `spending-strategies/forgo-inflation.ts`     | Skip the inflation raise after a losing year             |
| `spending-strategies/rmd-spending.ts`        | Spending scaled by the RMD factor                        |
| `spending-strategies/vpw.ts`                 | Variable Percentage Withdrawal, % of the balance by age  |

`fixed` is inline in the dispatcher. A new strategy = one module + one dispatch entry. Strategies size spending from the **retirement balance** only.

## One year

**Every year** — `runPreYearSetup`: return rate, profile switches, the spending strategy's target (from the retirement balance), the Portfolio exclusion for the year.

**Accumulation** — `runAccumulationYear`, in this order: `yearZeroBasis` and `yearContributionTarget` (`contribution-target.ts`: year 0's basis, the target, the employer match), `yearContributionLimits` and `routeYearSlots` (`contribution-slots.ts`, with `applyRateCeiling`), `yearContributionTotals`, `creditYearContributions` (lump sums) and `distributeYearContributions` (`contribution-credits.ts`), `yearGapDraw` (`goal-draws.ts`), `applyGrowth`, `brokerageGoalDraws` (Portfolio brokerages), then `closeYearAccounts` (`year-end-accounts.ts`: the per-account rows, `reconcileIndividualToAggregate`, `syncAggregateBasis`).

**When the phases change** — dates come from `lib/pure/household/household-timeline.ts`: plan dates (retirement year, end year) count from the primary person; per-person rules (catch-up, RMDs, 59½, the senior deduction) use that person's age; withdrawals start when the last person with a job retires (`retirementYear`), and the projection's last row is the year before `projectionEndYear` (the last person's end age): the end year itself isn't run, so a Projection to 95 stops at 94 (RULES.md § Known Gaps). Nothing averages the people.

**Gap years** — `gap-year-draw.ts`: an accumulation year where someone with a job has stopped draws the shortfall (spending less take-home pay and Social Security), before growth, through the same routing, eligibility, Roth split and penalty as a retirement year. Tax pricing differs today, until fixed: gap years size the draw with their own gross-up and leave out the 65+ deductions. Other accumulation years take pay as covering the budget: spending doesn't touch balances. RMDs aren't taken before withdrawals start: a gap year warns when one falls due; other accumulation years neither take nor warn (RULES.md § Known Gaps).

**Budget lines that end** — `expense-endings.ts`: a loan's line leaves as a share of each phase's budget the year after payoff. Typed figures and rate-seeded retirements are left alone.

**Decumulation** — `runDecumulationYear` (`decumulation-year.ts`) calls its stages in this order. What the year settles before its first draw (config, eligibility, the grown tax tables, Social Security, people 65+) is one `DecumulationYear` (`types.ts`); each later stage takes it and the earlier stages' results it reads, by name (`DecumulationFlow` in `tax-year-settlement.ts`, `RepricedFlow` in `conversion-year-reprice.ts`):

1. `resolveDecumulationConfig` — the year's settings; `computeWithdrawalEligibility` for each account
2. `rmdIncomeByOwner` (`decumulation-income.ts`) — each owner's RMD for the year
3. `qcdStep` (`rmd-step.ts`) — charitable distributions against the RMD
4. `growYearTaxTables` (`year-tax-tables.ts`, with `yearStandardDeduction` from `year-deduction.ts`) — the year's brackets, standard deduction with the 65+ and senior add-ons, LTCG thresholds, each grown from its own table year
5. `yearNeed` (`year-need.ts`) — the after-tax need (IRMAA in it) and `estimateWithdrawalTaxCost`, which sizes the withdrawal to cover its own tax (`met`, or `capped` with its shortfall)
6. `routeYearDraw` (`year-draws.ts`) — `routeForMode` routes the draw
7. `enforceYearRmd` (`rmd-step.ts`) — each RMD enforced on the routed draw
8. `distributeYearDraws` (`year-draws.ts`) — the draw followed to each account (Roth split, early-withdrawal penalty), worked out on copies of the per-account maps
9. `priceYearTax`, `pricedYearParts` (`tax-year-settlement.ts`) — the year's tax priced from the post-RMD totals (an RMD can add Traditional to the routed draw); when the RMD overrode routing, the reported gross-up factor is recomputed from them
10. `settleYearDraws` — the accounts' draws from stage 8 landed with `deductWithdrawals`, `clampBalances`, lump sums, `reinvestRmdExcess` (or the excess spent), `trackDepletions`
11. `yearRothConversion` — `computeRmdSmoothingTargets`, `performRothConversion`; `repriceConversionYear` (`conversion-year-reprice.ts`) re-prices the year's tax after it
12. `fundingShortfallForYear` (`funding-shortfall.ts`) — the unmet need (`unmetNeedRaw` inside the engine) and whether it's material
13. `yearCliffChecks` (`year-cliffs.ts`) — `checkHouseholdIrmaa` (per person `checkIrmaa` × people 65+), `checkAca`
14. `decumulationPortfolioContributions` (`portfolio-contributions.ts`) — Portfolio contributions after retirement, reported only
15. `closeDecumulationYear` (`year-end.ts`) — `applyGrowth`, `cleanupDust`, `reconcileIndividualToAggregate`, `syncAggregateBasis`, the year's row

Steps 9 to 11 are one stage, the tax settlement: `settleYearTax` (`tax-settlement.ts`) runs them in order and returns what each settled. The year's tax is priced with one deduction, `priced.standardDeduction`, which the conversion and the re-price read back.

`decumulationYearRow` (`decumulation-row.ts`) then builds the year's row: it reports `retirementBalance` / `allAccountsBalance`, unmet need and its reasons; `assessPlan` (`lib/pure/retirement/plan-outcome.ts`) judges the run.

## Undecided engine decisions

Four behaviours the engine spec leaves undecided have one named home each, with today's behaviour in its docblock. Each id is the spec's `UD-` number and the pending decision that settles it; changing the behaviour is that decision's work, not a refactor.

| Id         | What                     | Home                                                                                                                                      | Today                                                                                                                                                                                                                     |
| ---------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UD-01 (D2) | Year-0 proration         | `pre-year-setup.ts` `seedRetirementSpending`; `contribution-target.ts` `yearZeroBasis`; `contributions/cap-request.ts` `withLeftThisYear` | Only a working year 0 is pro-rated by months (contributions, match, growth, a gap year's draw); a job starting or ending this year puts in its limited rows' checks left instead (`leftThisYear`), every job from v0.11.1 |
| UD-02 (D3) | Mid-year retirement      | `pre-year-setup.ts` `yearPhase`                                                                                                           | Retiring in year 0 after its start runs it as a pro-rated working year; else whole                                                                                                                                        |
| UD-04 (D1) | The RMD top-up           | `rmd-step.ts` `enforceYearRmd`; `tax-year-settlement.ts` `settleYearDraws`                                                                | A short RMD adds Traditional on top of the routed draw; the excess is reinvested or spent                                                                                                                                 |
| UD-08 (D4) | What pays conversion tax | `tax-year-settlement.ts` `yearRothConversion`                                                                                             | The tax is paid from retirement brokerage money                                                                                                                                                                           |

## Types

Projection types live in `./types/` (the public ones through `./types/index.ts`): `ProjectionInput` / `ProjectionResult`, the resolved configs, `TaxBuckets` (aggregate by tax treatment), `AccountBalances` (per category; structure varies by account type), `IndividualAccountInput`, and `EngineYearProjection` (accumulation | decumulation). Module-specific input/result types stay in their module.
