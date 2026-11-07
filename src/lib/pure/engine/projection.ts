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
 * Year-level logic lives in projection-year-handlers/. This file owns
 * orchestration and result building; input validation is in
 * input-validation.ts.
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

  // Sustainable withdrawal at retirement — the strategy's own actual first
  // decumulation year withdrawal (strategy-real: reads the already-recorded
  // first decumulation year, rather than a
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
      // projection window (e.g. retirementYear beyond projectionEndYear) —
      // no strategy actually ran, so there's no real number to read. Same
      // `balance × withdrawalRate` reference-figure formula used before
      // this fix, applied only to this now-rare edge case. Depends on the
      // invariant (verified in pre-year-setup.ts's isAccumulation logic)
      // that every retirementYear <= first-year input lands in the branch
      // above instead — if that invariant is ever broken, this silently
      // falls back to $0 rather than erroring.
      roundToCents(
        (state.projectionByYear.find((p) => p.year === input.retirementYear)
          ?.retirementBalance ?? 0) *
          resolveDecumulationConfig(
            input.retirementYear,
            input.decumulationDefaults,
            ctx.sortedDecOverrides,
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
