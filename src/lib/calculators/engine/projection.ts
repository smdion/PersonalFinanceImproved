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
import { roundToCents } from "../../utils/math";
import {
  MAX_INFLATION_RATE,
  MIN_INFLATION_RATE,
} from "../../constants";
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
      `Salary growth rate clamped from ${(salaryGrowthRate * 100).toFixed(1)}% to -100%`,
    );
    salaryGrowthRate = -1;
  }

  if (inflationRate > MAX_INFLATION_RATE) {
    warnings.push(
      `Inflation rate clamped from ${(inflationRate * 100).toFixed(1)}% to ${(MAX_INFLATION_RATE * 100).toFixed(0)}%`,
    );
    inflationRate = MAX_INFLATION_RATE;
  } else if (inflationRate < MIN_INFLATION_RATE) {
    warnings.push(
      `Inflation rate clamped from ${(inflationRate * 100).toFixed(1)}% to ${(MIN_INFLATION_RATE * 100).toFixed(0)}%`,
    );
    inflationRate = MIN_INFLATION_RATE;
  }

  if (postRetirementInflationRate > MAX_INFLATION_RATE) {
    warnings.push(
      `Post-retirement raise rate clamped to ${(MAX_INFLATION_RATE * 100).toFixed(0)}%`,
    );
    postRetirementInflationRate = MAX_INFLATION_RATE;
  } else if (postRetirementInflationRate < MIN_INFLATION_RATE) {
    warnings.push(
      `Post-retirement raise rate clamped to ${(MIN_INFLATION_RATE * 100).toFixed(0)}%`,
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

  // Compute sustainable withdrawal at retirement
  const retirementYear = state.projectionByYear.find(
    (p) => p.age === input.retirementAge,
  );
  const retirementBalance = retirementYear?.endBalance ?? 0;
  const retirementConfig = resolveDecumulationConfig(
    input.asOfDate.getFullYear() + (input.retirementAge - input.currentAge),
    input.decumulationDefaults,
    ctx.sortedDecOverrides,
  );
  const sustainableWithdrawal = roundToCents(
    retirementBalance * retirementConfig.withdrawalRate,
  );

  return {
    projectionByYear: state.projectionByYear,
    firstOverflowYear: state.firstOverflowYear,
    firstOverflowAge: state.firstOverflowAge,
    firstOverflowAmount: state.firstOverflowAmount,
    portfolioDepletionYear: state.portfolioDepletionYear,
    portfolioDepletionAge: state.portfolioDepletionAge,
    sustainableWithdrawal,
    accountDepletions: state.accountDepletions,
    warnings,
  };
}
