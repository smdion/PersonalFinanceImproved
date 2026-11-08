/** The Coast FIRE (Custom) age check: an age box and its pass/fail result. */
import { formatPercent } from "@/lib/utils/format";
import type { ProjectionState } from "../projection-table-types";

export function CoastFireCustomAge({
  state,
  result,
  engineSettings,
}: {
  state: ProjectionState;
  result: NonNullable<ProjectionState["result"]>;
  engineSettings: NonNullable<ProjectionState["engineSettings"]>;
}) {
  const {
    coastFireCustomAge,
    setCoastFireCustomAge,
    coastFireCustomAgeDraft,
    setCoastFireCustomAgeDraft,
    coastFireProbeResult,
    coastFireProbeLoading,
    coastFireProbeError,
    checkCoastFireCustomAge,
  } = state;
  const currentAge = result.projectionByYear[0]?.age ?? 0;
  const maxAge = engineSettings.retirementAge - 1;
  const committedAge = coastFireCustomAge ?? currentAge;
  // The box shows the raw draft while typing; commitDraft clamps on blur or
  // "Check this age", because clamping per keystroke garbles multi-digit
  // entry.
  const draftText = coastFireCustomAgeDraft ?? String(committedAge);
  const commitDraft = (): number => {
    const v = parseInt(draftText, 10);
    const clamped = isNaN(v)
      ? committedAge
      : Math.min(maxAge, Math.max(currentAge, v));
    setCoastFireCustomAge(clamped);
    setCoastFireCustomAgeDraft(null);
    return clamped;
  };
  return (
    <div className="bg-surface-sunken -mt-1 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm">
      <label
        htmlFor="coast-fire-custom-age"
        className="text-caption text-muted"
      >
        {state.primaryName ? `Check ${state.primaryName}'s age` : "Check age"}
      </label>
      <input
        id="coast-fire-custom-age"
        type="number"
        min={currentAge}
        max={maxAge}
        step={1}
        value={draftText}
        onChange={(e) => setCoastFireCustomAgeDraft(e.target.value)}
        onBlur={commitDraft}
        className="w-16 rounded border px-1.5 py-0.5 text-sm tabular-nums"
      />
      <button
        type="button"
        onClick={() => checkCoastFireCustomAge(commitDraft())}
        disabled={coastFireProbeLoading}
        className="text-label border-subtle text-muted hover:bg-surface-primary/80 rounded-md border px-2.5 py-1 font-semibold shadow-sm transition-colors disabled:opacity-50"
      >
        {coastFireProbeLoading ? "Checking…" : "Check this age"}
      </button>
      {coastFireProbeError && (
        <span className="text-caption text-red-600">{coastFireProbeError}</span>
      )}
      {!coastFireProbeError &&
        coastFireProbeResult &&
        coastFireProbeResult.probeAge === committedAge && (
          <span
            className={`text-caption font-medium ${
              coastFireProbeResult.passes ? "text-green-600" : "text-red-600"
            }`}
          >
            {coastFireProbeResult.passes ? "✓ Passes" : "✗ Doesn't pass"} (
            {formatPercent(coastFireProbeResult.successRate, 0)})
          </span>
        )}
    </div>
  );
}
