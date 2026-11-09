/**
 * Advisor report gate: a simulation result from `mcQuery` alone (no placeholder or prefetch
 * fallback) for the current inputs, baseline scenario and Advanced tax mode; other scenarios
 * pair different results with baseline assumption text, so they're not offered.
 */

export type ReportGateFailure =
  | "not-baseline-scenario"
  | "simple-tax-mode"
  | "inputs-unsettled"
  | "engine-not-fresh"
  | "mc-not-fresh";

export interface ReportGateInput {
  projectionView: string;
  simulationTaxMode: "simple" | "advanced";
  /** Deep-equal-able live query input (`ProjectionQueries.sharedInput`). */
  sharedInput: unknown;
  /** Deep-equal-able debounced query input (`ProjectionQueries.debouncedInput`) —
   *  compared against `sharedInput` to detect an edit still in the debounce
   *  window. */
  debouncedInput: unknown;
  engineQuery: {
    isFetching: boolean;
    isPlaceholderData: boolean;
    data: unknown;
  };
  mcQuery: {
    isFetching: boolean;
    data: unknown;
  };
}

interface ReportGateResult {
  ok: boolean;
  /** First failing check, in the order a household should fix them —
   *  scenario/tax-mode are manual-switch fixes, the rest resolve by
   *  waiting or re-running. `undefined` when `ok` is true. */
  failure?: ReportGateFailure;
}

/** Deep-equal via JSON — matches the existing `simulationPrefetchRunId`/
 *  `rateSeededMcRunId` convention in use-projection-queries.ts, which
 *  already serializes these same plain-object query inputs the same way. */
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function checkReportGate(input: ReportGateInput): ReportGateResult {
  if (input.projectionView !== "baseline") {
    return { ok: false, failure: "not-baseline-scenario" };
  }
  if (input.simulationTaxMode === "simple") {
    return { ok: false, failure: "simple-tax-mode" };
  }
  if (!deepEqual(input.sharedInput, input.debouncedInput)) {
    return { ok: false, failure: "inputs-unsettled" };
  }
  if (
    input.engineQuery.isFetching ||
    input.engineQuery.isPlaceholderData ||
    !input.engineQuery.data
  ) {
    return { ok: false, failure: "engine-not-fresh" };
  }
  if (input.mcQuery.isFetching || !input.mcQuery.data) {
    return { ok: false, failure: "mc-not-fresh" };
  }
  return { ok: true };
}

/** User-facing copy per failure reason. Says "simulation", never the product name
 *  (tests/lint/violations.test.ts). */
export function reportGateFailureMessage(failure: ReportGateFailure): string {
  switch (failure) {
    case "not-baseline-scenario":
      return "The full report is only available for the Baseline scenario — switch back from the current scenario view to generate it.";
    case "simple-tax-mode":
      return "The full report's risk analysis needs Advanced tax mode. Switch to Advanced, then try again.";
    case "inputs-unsettled":
      return "Your latest changes are still being applied — try again in a moment.";
    case "engine-not-fresh":
      return "Your projection is still updating — try again in a moment.";
    case "mc-not-fresh":
      return "Run the simulation first, so the report's risk analysis reflects your current projection.";
  }
}
