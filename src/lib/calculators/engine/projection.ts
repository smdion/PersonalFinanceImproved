/**
 * Contribution / Distribution Engine
 *
 * Unified calculator that projects both accumulation (pre-retirement) and
 * decumulation (post-retirement) in a single pass, with full control over:
 *
 * - Routing mode (bracket_filling, waterfall, or percentage)
 * - Account allocation and priority order
 * - Roth/Traditional tax splits per account
 * - Artificial caps per account and per tax type
 * - Withdrawal order and tax preferences
 *
 * All settings support per-year sticky-forward overrides.
 * See types.ts for detailed documentation of each type.
 *
 * Year-level logic is extracted to projection-year-handlers.ts for
 * maintainability. This file owns validation, orchestration, and result building.
 */
import type { ProjectionInput, ProjectionResult } from "../types";
import { formatPercent } from "../../utils/format";
import { roundToCents } from "../../utils/math";
import { MAX_INFLATION_RATE, MIN_INFLATION_RATE } from "../../constants";
import { resolveDecumulationConfig } from "./override-resolution";
import {
  buildProjectionContext,
  buildProjectionState,
  runPreYearSetup,
  runAccumulationYear,
  runDecumulationYear,
} from "./projection-year-handlers";

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/**
 * Validate and clamp engine inputs. Pushes warnings for any clamped values.
 * Returns sanitized copies of fields that may need clamping.
 */
function validateEngineInputs(
  input: ProjectionInput,
  warnings: string[],
): {
  salaryGrowthRate: number;
  inflationRate: number;
  postRetirementInflationRate: number;
} {
  let { salaryGrowthRate, inflationRate } = input;
  let postRetirementInflationRate =
    input.postRetirementInflationRate ?? inflationRate;

  if (salaryGrowthRate < -1) {
    warnings.push(
      `Salary growth rate clamped from ${formatPercent(salaryGrowthRate, 1)} to -100%`,
    );
    salaryGrowthRate = -1;
  }

  if (inflationRate > MAX_INFLATION_RATE) {
    warnings.push(
      `Inflation rate clamped from ${formatPercent(inflationRate, 1)} to ${formatPercent(MAX_INFLATION_RATE)}`,
    );
    inflationRate = MAX_INFLATION_RATE;
  } else if (inflationRate < MIN_INFLATION_RATE) {
    warnings.push(
      `Inflation rate clamped from ${formatPercent(inflationRate, 1)} to ${formatPercent(MIN_INFLATION_RATE)}`,
    );
    inflationRate = MIN_INFLATION_RATE;
  }

  if (postRetirementInflationRate > MAX_INFLATION_RATE) {
    warnings.push(
      `Post-retirement raise rate clamped to ${formatPercent(MAX_INFLATION_RATE)}`,
    );
    postRetirementInflationRate = MAX_INFLATION_RATE;
  } else if (postRetirementInflationRate < MIN_INFLATION_RATE) {
    warnings.push(
      `Post-retirement raise rate clamped to ${formatPercent(MIN_INFLATION_RATE)}`,
    );
    postRetirementInflationRate = MIN_INFLATION_RATE;
  }

  if (input.returnRates.length === 0) {
    warnings.push("No return rates configured — investment growth will be 0%");
  }

  if (
    input.contributionSpecs &&
    input.contributionSpecs.length > 0 &&
    input.contributionSpecs.every((s) => s.baseAnnual === 0 && s.value === 0)
  ) {
    warnings.push("All contribution accounts have $0 contributions configured");
  }

  return { salaryGrowthRate, inflationRate, postRetirementInflationRate };
}

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

export function calculateProjection(input: ProjectionInput): ProjectionResult {
  const warnings: string[] = [];
  const validated = validateEngineInputs(input, warnings);

  // Warn if percentage mode is selected but no withdrawal splits are configured
  if (
    input.decumulationDefaults.withdrawalRoutingMode === "percentage" &&
    !input.decumulationDefaults.withdrawalSplits
  ) {
    warnings.push(
      "Percentage withdrawal mode selected but no withdrawal splits configured — withdrawals will be $0. Configure splits in Retirement settings.",
    );
  }

  // Date/age boundary validation
  if (input.retirementAge <= input.currentAge) {
    warnings.push(
      `Retirement age (${input.retirementAge}) is at or before current age (${input.currentAge}) — entire projection will be in decumulation.`,
    );
  }
  if (input.retirementAge > input.projectionEndAge) {
    warnings.push(
      `Retirement age (${input.retirementAge}) is beyond projection end age (${input.projectionEndAge}) — retirement phase will never be reached.`,
    );
  }

  // Build immutable context and mutable state
  const ctx = buildProjectionContext(input, validated);
  const state = buildProjectionState(input, ctx);

  // Main projection loop
  for (let y = 0; y < ctx.yearsToProject; y++) {
    const setup = runPreYearSetup(ctx, state, y);

    if (setup.isAccumulation) {
      runAccumulationYear(ctx, state, y, setup);
    } else {
      runDecumulationYear(ctx, state, y, setup);
    }
  }

  // Sustainable withdrawal at retirement — the strategy's own actual first
  // decumulation year withdrawal (R45 Step 2, Job (i) "make it strategy-real":
  // reads the already-recorded first decumulation year, rather than a
  // `balance × withdrawalRate` figure only 4 of 8 strategies' spending math
  // actually reads).
  //
  // `targetWithdrawal` (advisor-corrected — NOT `totalWithdrawal`) is the
  // right field: it's the tax-grossed-up amount the strategy actually
  // determined it needs to withdraw to cover its spending need
  // (`decumulation-year.ts`'s `taxEst.targetWithdrawal`, computed BEFORE
  // statutory RMD enforcement can force `totalWithdrawal` above it).
  // `totalWithdrawal` can be materially larger than what the household is
  // actually spending in an RMD-active year — the excess over need gets
  // reinvested into brokerage (`reinvestRmdExcess`), never spent — so using
  // it here would report a "sustainable withdrawal" inflated by money the
  // household never touches. `targetWithdrawal` avoids that distortion.
  const firstDecumYear = state.projectionByYear.find(
    (p) => p.phase === "decumulation",
  );
  const sustainableWithdrawal = firstDecumYear
    ? roundToCents(firstDecumYear.targetWithdrawal)
    : // Fallback for inputs where decumulation is never reached within the
      // projection window (e.g. retirementAge beyond projectionEndAge) —
      // no strategy actually ran, so there's no real number to read. Same
      // `balance × withdrawalRate` reference-figure formula used before
      // this fix, applied only to this now-rare edge case. Depends on the
      // invariant (verified in pre-year-setup.ts's isAccumulation logic)
      // that every currentAge >= retirementAge input lands in the branch
      // above instead — if that invariant is ever broken, this silently
      // falls back to $0 rather than erroring.
      roundToCents(
        (state.projectionByYear.find((p) => p.age === input.retirementAge)
          ?.endBalance ?? 0) *
          resolveDecumulationConfig(
            input.asOfDate.getFullYear() +
              (input.retirementAge - input.currentAge),
            input.decumulationDefaults,
            ctx.sortedDecOverrides,
          ).withdrawalRate,
      );

  // Household's stated need, inflated to the first decumulation year's
  // nominal dollars — same formula pre-year-setup.ts:209-211 uses to seed
  // year-1 decumulation spending, before any strategy adjusts it. Computed
  // independently here (post-hoc, like sustainableWithdrawal above) since
  // the per-strategy dispatch overwrites state.projectedExpenses before the
  // loop ends, so the pre-strategy "need" value isn't otherwise retained.
  //
  // The exponent MUST be the actual first decumulation year's offset from
  // asOfDate, not `retirementAge - currentAge` — pre-year-setup.ts's mid-year
  // retirement handling can defer the first decumulation year by one extra
  // year (when retirementAge === currentAge but the current date isn't
  // exactly year-start), and a naive age-based exponent silently
  // under-inflates relative to what the loop actually produced. Reading the
  // loop's own first decumulation row keeps this a single source of truth
  // instead of a second, divergence-prone computation of "which year."
  const firstDecumulationYearStatedNeed =
    input.decumulationAnnualExpenses != null && firstDecumYear
      ? roundToCents(
          input.decumulationAnnualExpenses *
            Math.pow(
              1 + ctx.inflationRate,
              Math.max(0, firstDecumYear.year - input.asOfDate.getFullYear()),
            ),
        )
      : null;

  return {
    projectionByYear: state.projectionByYear,
    firstOverflowYear: state.firstOverflowYear,
    firstOverflowAge: state.firstOverflowAge,
    firstOverflowAmount: state.firstOverflowAmount,
    portfolioDepletionYear: state.portfolioDepletionYear,
    portfolioDepletionAge: state.portfolioDepletionAge,
    sustainableWithdrawal,
    firstDecumulationYearStatedNeed,
    accountDepletions: state.accountDepletions,
    warnings,
  };
}
