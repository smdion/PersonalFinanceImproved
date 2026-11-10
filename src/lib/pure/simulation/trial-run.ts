/** The Simulation's trials: each one's draws, its engine run and what it records. */
import {
  planEndAge,
  planRetirementAge,
} from "@/lib/pure/household/household-timeline";
import { strategySpending } from "../retirement/strategy-spending";
import { assessPlan, type PlanFailureReason } from "../retirement/plan-outcome";
import { calculateProjection } from "../engine";
import { buildInflationPath } from "../engine/inflation-path";
import { strategyAnchorRate } from "@/lib/pure/retirement/gk-anchor-rate";
import { createPRNG, sampleBlendedReturn, sampleNormalMeanStd } from "./random";
import type { MonteCarloInput } from "./monte-carlo.types";
import type { ProjectionInput, EngineDecumulationYear } from "../engine/types";
import { roundToCents, safeDivide } from "../../utils/math";
import { SIMULATION_SPENDING_STABILITY_THRESHOLD } from "../../constants";

export function runTrials(
  engineInput: ProjectionInput,
  numTrials: number,
  onProgress: ((done: number, total: number) => void) | undefined,
  seed: number,
  assetClasses: MonteCarloInput["assetClasses"],
  choleskyL: number[][],
  glidePath: MonteCarloInput["glidePath"],
  clampMin: number,
  clampMax: number,
  inflationRisk: MonteCarloInput["inflationRisk"],
  strategyUsesRaise: boolean,
) {
  // Compute deterministic projection first (always returned for comparison)
  const deterministicProjection = calculateProjection(engineInput);

  // Projection parameters
  const startAge = engineInput.currentAge;
  const endAge = planEndAge(engineInput);
  const numYears = endAge - startAge + 1;

  // Storage for per-year balances across trials (year index → array of end
  // balances), nominal and in today's dollars — each trial deflated by its
  // own inflation before sorting, never the percentiles afterwards.
  const balancesByYear: number[][] = Array.from({ length: numYears }, () => []);
  const balancesTodayByYear: number[][] = Array.from(
    { length: numYears },
    () => [],
  );

  // Storage for per-decumulation-year spending ratios across trials
  // Index 0 = first decumulation year, not first projection year
  const numDecumulationYears = Math.max(
    0,
    endAge - planRetirementAge(engineInput) + 1,
  );
  const stratRatiosByDecumulationYear: number[][] = Array.from(
    { length: numDecumulationYears },
    () => [],
  );
  const budgetRatiosByDecumulationYear: number[][] = Array.from(
    { length: numDecumulationYears },
    () => [],
  );

  // Per-trial outcome tracking
  const terminalBalances: number[] = [];
  const terminalBalancesToday: number[] = [];
  // Trials that failed on a penalty gap (money there but locked behind
  // early-withdrawal penalties), and every trial's verdict. Parallel arrays
  // to terminalBalances, indexed by trial.
  const hadPenaltyAvoidedShortfall: boolean[] = [];
  const trialSucceeded: boolean[] = [];
  // Per trial, the decumulation years' penaltyAvoidedShortfall summed in today's dollars (by
  // pvDeflator): how much the 55->59½ gap leaves short. 0 unless the boolean above is true.
  const penaltyAvoidedShortfallAmountsPV: number[] = [];
  const failureAges: number[] = [];
  const failureReasonCounts: Record<PlanFailureReason, number> = {
    depleted: 0,
    penaltyGap: 0,
    shortfall: 0,
  };
  const sustainableWithdrawals: number[] = [];
  const sustainableWithdrawalsPV: number[] = [];
  let spendingStableCount = 0;
  let budgetStableCount = 0;

  // Each trial's price level by year, for the assumptions on the bands.
  const strategy = engineInput.decumulationDefaults.withdrawalStrategy;
  const gkAnchorRates: number[] = [];
  const priceLevelsByYear: number[][] = Array.from(
    { length: numYears },
    () => [],
  );

  const yearsToRetirement = planRetirementAge(engineInput) - startAge;
  // The household's own rates — each trial's inflation varies around them.
  const baseInflation = engineInput.inflationRate;
  const basePostRetirementInflation =
    engineInput.postRetirementInflationRate ?? baseInflation;

  // Report progress every ~2% of trials so the callback overhead stays negligible while a caller
  // can still show "N/total".
  const progressInterval = Math.max(1, Math.floor(numTrials / 50));

  // Run trials
  for (let trial = 0; trial < numTrials; trial++) {
    if (
      onProgress &&
      (trial % progressInterval === 0 || trial === numTrials - 1)
    ) {
      onProgress(trial, numTrials);
    }
    const rng = createPRNG(seed + trial);

    // Generate randomized return rates for this trial
    const trialReturnRates: { label: string; rate: number }[] = [];
    for (let yearIndex = 0; yearIndex < numYears; yearIndex++) {
      const age = startAge + yearIndex;
      // Correlated log-normal draws, centered on the asset class means and
      // blended by this age's glide path.
      let annualReturn = sampleBlendedReturn(
        rng,
        assetClasses,
        choleskyL,
        glidePath,
        age,
      );

      // Clamp extreme returns (prevent unrealistic scenarios)
      annualReturn = Math.max(annualReturn, clampMin);
      annualReturn = Math.min(annualReturn, clampMax);

      trialReturnRates.push({ label: `Age ${age}`, rate: annualReturn });
    }

    // Optional inflation risk: one shock per year around the household's rates, moving both
    // rates together (the engine reads the same path). No spread = the plan's exact rates.
    const inflationShocks =
      inflationRisk && inflationRisk.stdDev > 0
        ? Array.from({ length: numYears }, () =>
            sampleNormalMeanStd(rng, 0, inflationRisk.stdDev),
          )
        : undefined;
    const trialInflation = buildInflationPath({
      inflationRate: baseInflation,
      postRetirementInflationRate: basePostRetirementInflation,
      baseYear: engineInput.asOfDate.getFullYear(),
      shocks: inflationShocks,
    });
    // Today's dollars for this trial: deflated by the inflation it ran with
    // (the app's convention — the general rate, every year), so a hot trial
    // reads poorer in today's dollars than a cool one with the same balance.
    const todayDeflator = (yearIndex: number) =>
      trialInflation.growth(yearIndex);
    if (inflationShocks)
      for (let yearIndex = 0; yearIndex < numYears; yearIndex++)
        priceLevelsByYear[yearIndex]!.push(todayDeflator(yearIndex));
    const pvDeflator = todayDeflator(yearsToRetirement);

    // Build modified engine input for this trial.
    const trialInput: ProjectionInput = {
      ...engineInput,
      returnRates: trialReturnRates,
      inflationShocks,
    };

    // Run the engine
    const result = calculateProjection(trialInput);

    // Collect per-year end balances.
    // Retirement money (A6): Portfolio balances never fund retirement, so
    // the bands, median and terminal balances leave them out.
    for (
      let yearIndex = 0;
      yearIndex < numYears && yearIndex < result.projectionByYear.length;
      yearIndex++
    ) {
      const balance = result.projectionByYear[yearIndex]!.retirementBalance;
      balancesByYear[yearIndex]!.push(roundToCents(balance));
      balancesTodayByYear[yearIndex]!.push(
        roundToCents(balance / todayDeflator(yearIndex)),
      );
    }

    // Terminal balance
    const lastIndex = result.projectionByYear.length - 1;
    const lastYear = result.projectionByYear[lastIndex];
    terminalBalances.push(roundToCents(lastYear?.retirementBalance ?? 0));
    terminalBalancesToday.push(
      roundToCents(
        (lastYear?.retirementBalance ?? 0) / todayDeflator(lastIndex),
      ),
    );

    // One judge (plan-outcome.ts): fails when retirement money runs out or a year's spending
    // goes unmet, never kept alive by an unspendable balance. Penalty gaps are tallied too.
    const outcome = assessPlan(result);
    trialSucceeded.push(outcome.succeeded);
    hadPenaltyAvoidedShortfall.push(outcome.failureReason === "penaltyGap");
    // Each year's shortfall in today's dollars by its own year — summing
    // nominal years and dividing once by the retirement-year deflator gave
    // retirement-year dollars.
    penaltyAvoidedShortfallAmountsPV.push(
      result.projectionByYear.reduce(
        (sum, y, i) =>
          y.phase === "decumulation"
            ? sum + (y.penaltyAvoidedShortfall ?? 0) / todayDeflator(i)
            : sum,
        0,
      ),
    );

    // Failure age and reason (the plan judge's, not depletion alone).
    if (!outcome.succeeded) {
      failureAges.push(outcome.failureAge);
      failureReasonCounts[outcome.failureReason]++;
    }

    // Spending stability: withdrawals ≥ the threshold share of baseline every decumulation year.
    // Baseline: targetWithdrawal for post-retirement-raise strategies; otherwise year-1's
    // withdrawal grown by the trial's inflation.
    const anchor = strategyAnchorRate(strategy, result.projectionByYear);
    if (anchor !== null) gkAnchorRates.push(anchor);
    const decumulationYears = result.projectionByYear.filter(
      (y): y is EngineDecumulationYear => y.phase === "decumulation",
    );
    if (decumulationYears.length > 0) {
      const year1Withdrawal = decumulationYears[0]!.totalWithdrawal;
      // Year 1's withdrawal, kept up with the inflation this trial saw.
      const firstDecumulationIndex =
        decumulationYears[0]!.year - engineInput.asOfDate.getFullYear();
      const inflatedYear1 = (i: number) =>
        year1Withdrawal *
        trialInflation.growthBetween(
          firstDecumulationIndex,
          firstDecumulationIndex + i,
        );
      const isStable =
        year1Withdrawal === 0 ||
        decumulationYears.every((y, i) => {
          const baseline = strategyUsesRaise
            ? y.targetWithdrawal
            : inflatedYear1(i);
          // A depleted portfolio (both target and actual = 0) is NOT stable
          if (baseline === 0 && y.totalWithdrawal === 0 && i > 0) return false;
          return (
            baseline === 0 ||
            y.totalWithdrawal >=
              SIMULATION_SPENDING_STABILITY_THRESHOLD * baseline
          );
        });
      if (isStable) spendingStableCount++;

      // Budget stability: strategySpending against the year's real budget (budgetOnlyExpenses,
      // never changed by a strategy's guardrails, unlike projectedExpenses) — spending against
      // spending, since the gross withdrawal is net of Social Security and gross of tax.
      const isBudgetStable = decumulationYears.every((y) => {
        const baseline = y.budgetOnlyExpenses;
        return (
          baseline === 0 ||
          strategySpending(y) >=
            SIMULATION_SPENDING_STABILITY_THRESHOLD * baseline
        );
      });
      if (isBudgetStable) budgetStableCount++;
      // Per-year spending ratios for stability chart bands.
      for (
        let di = 0;
        di < decumulationYears.length && di < numDecumulationYears;
        di++
      ) {
        const yearRow = decumulationYears[di]!;
        const stratBase = strategyUsesRaise
          ? yearRow.targetWithdrawal
          : inflatedYear1(di);
        stratRatiosByDecumulationYear[di]!.push(
          safeDivide(yearRow.totalWithdrawal, stratBase, 0),
        );
        budgetRatiosByDecumulationYear[di]!.push(
          safeDivide(strategySpending(yearRow), yearRow.budgetOnlyExpenses, 0),
        );
      }
    } else {
      spendingStableCount++; // no decumulation = vacuously stable
      budgetStableCount++;
    }

    // Sustainable withdrawal (nominal and present value)
    sustainableWithdrawals.push(result.sustainableWithdrawal);
    sustainableWithdrawalsPV.push(
      safeDivide(result.sustainableWithdrawal, pvDeflator, 0),
    );
  }
  onProgress?.(numTrials, numTrials);

  return {
    deterministicProjection,
    startAge,
    numYears,
    balancesByYear,
    balancesTodayByYear,
    numDecumulationYears,
    stratRatiosByDecumulationYear,
    budgetRatiosByDecumulationYear,
    terminalBalances,
    terminalBalancesToday,
    hadPenaltyAvoidedShortfall,
    trialSucceeded,
    penaltyAvoidedShortfallAmountsPV,
    failureAges,
    failureReasonCounts,
    sustainableWithdrawals,
    sustainableWithdrawalsPV,
    spendingStableCount,
    budgetStableCount,
    gkAnchorRates,
    priceLevelsByYear,
    yearsToRetirement,
  };
}
