/**
 * Gate for the retirement advisor report: is there a Monte Carlo result
 * that genuinely reflects the household's CURRENT inputs, for the
 * currently-selected scenario, computed under Advanced tax mode?
 *
 * "Does `mcResult` exist" is NOT a safe proxy for this — verified against
 * the actual query behavior in use-projection-queries.ts (advisor review,
 * 2026-08-31):
 *  - `mcPrefetchQuery`/`coastFireMcQuery`/`rateSeededMcQuery` all use
 *    `placeholderData: (prev) => prev` — a stale result from a PREVIOUS
 *    input survives across changes and reads as "present."
 *  - `coastFireProbeResult` is a bare `useState`, never cleared on input
 *    change at all.
 *  - `mcPrefetchQuery` hardcodes preset/trial-count regardless of the
 *    household's actual selection — falling back to it would print risk
 *    numbers computed under different assumptions than the report's own
 *    assumptions section states.
 *  - The debounce window is an unguarded hole: edit a setting and print
 *    immediately, `debouncedInput` hasn't caught up yet, nothing looks
 *    "fetching" — the report would print the pre-edit plan.
 *
 * `mcQuery` itself (the ONLY source this checks — no prefetch fallback,
 * ever) uses `placeholderData: undefined`, so it genuinely has no data
 * for a changed input until that input's own fetch resolves — the
 * fetching/data-presence checks below are sufficient for it without a
 * separate placeholder flag.
 *
 * Scoped to `scenarioView === "baseline"` only (see aca-irmaa-narrative.ts
 * sibling docs / FEATURE-ROADMAP.md) — Coast FIRE/Rate-Seeded scenarios
 * source both their MC result AND their deterministic projection from a
 * different place (`activeAltMcResult`), and the report's assumptions
 * section always echoes the BASELINE engine settings regardless of
 * scenario. Combining "Coast FIRE numbers" with "baseline assumptions
 * text" would misrepresent the plan, so those scenarios aren't offered
 * the advisor report in this pass — same reasoning covers
 * `coastFireProbeResult`, which additionally has no freshness signal at
 * all to check.
 */

export type ReportGateFailure =
  | "not-baseline-scenario"
  | "simple-tax-mode"
  | "inputs-unsettled"
  | "engine-not-fresh"
  | "mc-not-fresh";

export interface ReportGateInput {
  scenarioView: string;
  mcTaxMode: "simple" | "advanced";
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

export interface ReportGateResult {
  ok: boolean;
  /** First failing check, in the order a household should fix them —
   *  scenario/tax-mode are manual-switch fixes, the rest resolve by
   *  waiting or re-running. `undefined` when `ok` is true. */
  failure?: ReportGateFailure;
}

/** Deep-equal via JSON — matches the existing `mcPrefetchRunId`/
 *  `rateSeededMcRunId` convention in use-projection-queries.ts, which
 *  already serializes these same plain-object query inputs the same way. */
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function checkReportGate(input: ReportGateInput): ReportGateResult {
  if (input.scenarioView !== "baseline") {
    return { ok: false, failure: "not-baseline-scenario" };
  }
  if (input.mcTaxMode === "simple") {
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

/** User-facing copy per failure reason — kept alongside the predicate so
 *  the two can't drift. "Run the simulation first," not "Run Monte Carlo
 *  simulation first" (tests/lint/violations.test.ts bans the product name
 *  in user-facing text; see this module's coverage in that test's
 *  filterExt list). */
export function reportGateFailureMessage(failure: ReportGateFailure): string {
  switch (failure) {
    case "not-baseline-scenario":
      return "The advisor report is only available for your baseline plan — switch back from the current scenario view to generate it.";
    case "simple-tax-mode":
      return "The advisor report's risk analysis needs Advanced tax mode. Switch to Advanced, then try again.";
    case "inputs-unsettled":
      return "Your latest changes are still being applied — try again in a moment.";
    case "engine-not-fresh":
      return "Your projection is still updating — try again in a moment.";
    case "mc-not-fresh":
      return "Run the simulation first, so the report's risk analysis reflects your current plan.";
  }
}
