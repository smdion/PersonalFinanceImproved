/** The Simulation's trials: each one's draws, its engine run and what it records. */
import {
  planEndAge,
  planRetirementAge,
} from "@/lib/pure/household/household-timeline";
import { strategySpending } from "../retirement/strategy-spending";
import { assessPlan, type PlanFailureReason } from "../retirement/plan-outcome";
import { calculateProjection } from "../engine";
import { buildInflationPath } from "../engine/inflation-path";
import { gkAnchorRate } from "@/lib/pure/retirement/gk-anchor-rate";
import { createPRNG, sampleBlendedReturn, sampleNormalMeanStd } from "./random";
import type { MonteCarloInput } from "./monte-carlo.types";
import type { ProjectionInput, EngineDecumulationYear } from "../engine/types";
import { roundToCents, safeDivide } from "../../utils/math";
import { MC_SPENDING_STABILITY_THRESHOLD } from "../../constants";

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
  const numDecYears = Math.max(0, endAge - planRetirementAge(engineInput) + 1);
  const stratRatiosByDecYear: number[][] = Array.from(
    { length: numDecYears },
    () => [],
  );
  const budgetRatiosByDecYear: number[][] = Array.from(
    { length: numDecYears },
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
  // Dollar magnitude alongside the boolean above -- per trial, the sum of
  // every decumulation year's penaltyAvoidedShortfall, in TODAY's dollars
  // (deflated by pvDeflator, same convention as sustainableWithdrawalsPV
  // below). Lets a caller answer "how much" a household is short by the
  // 55->59½ gap, not just "how often" -- a bare % rate doesn't tell anyone
  // what to actually go build. Only meaningful for trials where the
  // boolean above is true; 0 otherwise.
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
  const tracksGkAnchor =
    engineInput.decumulationDefaults.withdrawalStrategy === "guyton_klinger";
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

  // Report progress every ~2% of trials (min every 20 trials) so the
  // callback overhead never becomes noticeable against the loop itself,
  // while still giving a caller something to show a determinate "N/total"
  // state with.
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

    // Optionally randomize inflation: a shock per year around the
    // household's own rates. One shock path moves both rates, keeping the
    // household's gap between the post-retirement raise and inflation, and
    // the engine reads the same path. No spread = no shocks, exactly the
    // plan's rates.
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

    // One judge (plan-outcome.ts): the trial fails when retirement money
    // runs out or a year's spending goes unmet (money penalty-locked, only
    // in Portfolio accounts, or past what routing can reach) — never kept
    // alive by a terminal balance it couldn't spend. A penalty gap is also
    // tallied on its own below.
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

    // Spending stability: did withdrawals stay ≥75% of baseline every decumulation year?
    // For strategies that use post-retirement raise (Fixed, Forgo, G-K, Decline),
    // use the engine's projectedExpenses as baseline — it already has the correct
    // inflation applied. For dynamic strategies (Vanguard, Const%, Endowment, RMD),
    // use year-1 withdrawal grown by the trial's general inflation — "did
    // spending hold in real terms" is a price question, and these
    // strategies don't use the post-retirement raise.
    if (tracksGkAnchor) {
      const anchor = gkAnchorRate(result.projectionByYear);
      if (anchor !== null) gkAnchorRates.push(anchor);
    }
    const decYears = result.projectionByYear.filter(
      (y): y is EngineDecumulationYear => y.phase === "decumulation",
    );
    if (decYears.length > 0) {
      const year1Withdrawal = decYears[0]!.totalWithdrawal;
      // Year 1's withdrawal, kept up with the inflation this trial saw.
      const firstDecumulationIndex =
        decYears[0]!.year - engineInput.asOfDate.getFullYear();
      const inflatedYear1 = (i: number) =>
        year1Withdrawal *
        trialInflation.growthBetween(
          firstDecumulationIndex,
          firstDecumulationIndex + i,
        );
      const isStable =
        year1Withdrawal === 0 ||
        decYears.every((y, i) => {
          const baseline = strategyUsesRaise
            ? y.targetWithdrawal
            : inflatedYear1(i);
          // A depleted portfolio (both target and actual = 0) is NOT stable
          if (baseline === 0 && y.totalWithdrawal === 0 && i > 0) return false;
          return (
            baseline === 0 ||
            y.totalWithdrawal >= MC_SPENDING_STABILITY_THRESHOLD * baseline
          );
        });
      if (isStable) spendingStableCount++;

      // Budget stability: same check but against the user's ACTUAL per-year
      // budget (y.budgetOnlyExpenses — the engine's own real budget figure
      // for that specific year, already reflecting any raises/phase
      // changes the household's Budget Profile defines, and NEVER mutated
      // by a reactive strategy's guardrail adjustment) rather than a
      // synthetic flat-inflation reprojection of the day-0 number.
      // y.projectedExpenses looked right but isn't: for Guyton-Klinger/
      // Forgo/Spending-Decline it's overwritten by that strategy's own
      // guardrail target every year, which silently collapsed "vs budget"
      // into being identical to "vs strategy" (both KPI rings showing the same percentage).
      // Compared with what the strategy has the household spend
      // (strategySpending) — the budget is spending, while the gross
      // withdrawal is net of Social Security and gross of tax.
      const isBudgetStable = decYears.every((y) => {
        const baseline = y.budgetOnlyExpenses;
        return (
          baseline === 0 ||
          strategySpending(y) >= MC_SPENDING_STABILITY_THRESHOLD * baseline
        );
      });
      if (isBudgetStable) budgetStableCount++;
      // Per-year spending ratios for stability chart bands.
      for (let di = 0; di < decYears.length && di < numDecYears; di++) {
        const yearRow = decYears[di]!;
        const stratBase = strategyUsesRaise
          ? yearRow.targetWithdrawal
          : inflatedYear1(di);
        stratRatiosByDecYear[di]!.push(
          safeDivide(yearRow.totalWithdrawal, stratBase, 0),
        );
        budgetRatiosByDecYear[di]!.push(
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
    numDecYears,
    stratRatiosByDecYear,
    budgetRatiosByDecYear,
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
