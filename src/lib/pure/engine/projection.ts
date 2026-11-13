/**
 * Contribution/distribution engine: projects accumulation and decumulation in one pass with
 * per-year sticky-forward overrides. Year logic lives in projection-year-handlers/.
 */
import type {
  ProjectionInput,
  ProjectionResult,
} from "./types/projection-result";
import { roundToCents } from "../../utils/math";
import { validateEngineInputs } from "./input-validation";
import { resolveDecumulationConfig } from "./override-resolution";
import { buildProjectionContext } from "./projection-year-handlers/context";
import { buildProjectionState } from "./projection-year-handlers/state";
import { runPreYearSetup } from "./projection-year-handlers/pre-year-setup";
import { runAccumulationYear } from "./projection-year-handlers/accumulation-year";
import { runDecumulationYear } from "./projection-year-handlers/decumulation-year";

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

  // A stored row without the overlay switch (no converter reached it) reads as on.
  if (
    input.decumulationDefaults.distributionTaxRates.rothBracketOverlay === null
  )
    warnings.push(
      "Your retirement settings have no Roth bracket overlay setting saved, so it was read as on. Save your Taxes settings to set it.",
    );

  // Date/age boundary validation
  if (input.retirementYear <= input.asOfDate.getFullYear()) {
    warnings.push(
      `Retirement year (${input.retirementYear}) is this year or earlier — entire projection will be in decumulation.`,
    );
  }
  if (input.retirementYear > input.projectionEndYear) {
    warnings.push(
      `Retirement year (${input.retirementYear}) is beyond the projection's end (${input.projectionEndYear}) — retirement phase will never be reached.`,
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

  // Sustainable withdrawal at retirement: the first decumulation year's
  // `targetWithdrawal` (tax-grossed need, before RMDs force more), not
  // `totalWithdrawal`, whose RMD excess is reinvested, never spent.
  const firstDecumYear = state.projectionByYear.find(
    (p) => p.phase === "decumulation",
  );
  const sustainableWithdrawal = firstDecumYear
    ? roundToCents(firstDecumYear.targetWithdrawal)
    : // Decumulation never reached in the window: no strategy ran, so use
      // the `balance × withdrawalRate` reference figure ($0 if missing).
      roundToCents(
        (state.projectionByYear.find((p) => p.year === input.retirementYear)
          ?.retirementBalance ?? 0) *
          resolveDecumulationConfig(
            input.retirementYear,
            input.decumulationDefaults,
            ctx.sortedDecumulationOverrides,
          ).withdrawalRate,
      );

  return {
    projectionByYear: state.projectionByYear,
    firstOverflowYear: state.firstOverflowYear,
    firstOverflowAge: state.firstOverflowAge,
    firstOverflowAmount: state.firstOverflowAmount,
    retirementDepletionYear: state.retirementDepletionYear,
    retirementDepletionAge: state.retirementDepletionAge,
    sustainableWithdrawal,
    firstDecumulationYearStatedNeed: state.firstDecumulationYearStatedNeed,
    accountDepletions: state.accountDepletions,
    warnings,
  };
}
