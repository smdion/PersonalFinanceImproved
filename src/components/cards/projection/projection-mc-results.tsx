"use client";

/** Monte Carlo results — loading spinner, errors, warnings, depletion callout, and compact summary bar. */
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type { useProjectionState } from "./use-projection-state";

type ProjectionState = ReturnType<typeof useProjectionState>;

/** Compact depletion callout (1-liner) shown when MC has a depletion age. */
export function McDepletionCallout({ s }: { s: ProjectionState }) {
  const { result, engineSettings, deflate, baseYear, mcQuery, mcLoading } = s;

  if (!result || !mcQuery.data?.result || mcLoading) return null;
  if (!mcQuery.data.result.distributions.depletionAge) return null;

  const mc = mcQuery.data.result;
  const terminalYear =
    baseYear +
    (engineSettings!.endAge - (result.projectionByYear[0]?.age ?? 0));
  const tb = mc.distributions.terminalBalance;
  const deplPct = Math.round((1 - mc.successRate) * 100);
  const isLowRisk = mc.successRate >= 0.9;
  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${isLowRisk ? "bg-surface-elevated text-muted" : "bg-red-50 text-red-700"}`}
    >
      <span className="font-medium shrink-0">
        {isLowRisk ? "\u2139\uFE0F" : "\u26A0"}{" "}
        {isLowRisk
          ? `In rare scenarios (${deplPct}%), money runs out around age ${Math.round(mc.distributions.depletionAge!.median)}.`
          : `In ${deplPct}% of futures, money runs out around age ${Math.round(mc.distributions.depletionAge!.median)}.`}
      </span>
      <span className={isLowRisk ? "text-muted" : "text-red-600"}>
        Typical end balance: {formatCurrency(deflate(tb.median, terminalYear))}
      </span>
      <HelpTip
        maxWidth={400}
        lines={[
          "Terminal balance distribution (today\u2019s dollars):",
          `Bad luck (p10): ${formatCurrency(deflate(tb.p10, terminalYear))}`,
          `Below avg (p25): ${formatCurrency(deflate(tb.p25, terminalYear))}`,
          `Typical (p50): ${formatCurrency(deflate(tb.median, terminalYear))}`,
          `Above avg (p75): ${formatCurrency(deflate(tb.p75, terminalYear))}`,
          `Good luck (p90): ${formatCurrency(deflate(tb.p90, terminalYear))}`,
          isLowRisk
            ? "Only a small fraction of simulated scenarios show depletion — this is within normal planning margins."
            : "A bad stretch of returns early in retirement can drain your portfolio before it recovers.",
        ]}
      />
    </div>
  );
}

/** MC loading, errors, warnings, and compact summary bar. */
export function McResultsSection({ s }: { s: ProjectionState }) {
  const {
    projectionMode,
    mcTrials,
    mcPreset,
    mcLoading,
    mcQuery,
    setShowAssumptions,
  } = s;

  if (projectionMode !== "monteCarlo") return null;

  return (
    <div className="space-y-3">
      {mcLoading && (
        <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted">
          <svg
            aria-hidden="true"
            className="animate-spin h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          Running {mcTrials.toLocaleString()} simulations ({mcPreset})...
        </div>
      )}
      {mcQuery.error && (
        <div className="text-sm text-red-500 py-4">
          Monte Carlo failed: {mcQuery.error.message}
        </div>
      )}
      {mcQuery.data?.result && !mcLoading && (
        <>
          {/* MC warnings */}
          {mcQuery.data.result.warnings.length > 0 && (
            <div className="text-xs text-amber-600 bg-amber-50 rounded px-3 py-2">
              {mcQuery.data.result.warnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
          )}
          {/* MC compact summary bar */}
          {mcQuery.data.simulationInputs &&
            (() => {
              const si = mcQuery.data.simulationInputs;
              const mcr = mcQuery.data.result!;
              const presetBar: Record<
                string,
                {
                  bg: string;
                  border: string;
                  pill: string;
                  accent: string;
                }
              > = {
                aggressive: {
                  bg: "bg-red-50/60",
                  border: "border-red-200",
                  pill: "text-white bg-red-500",
                  accent: "text-red-700",
                },
                default: {
                  bg: "bg-blue-50/60",
                  border: "border-blue-200",
                  pill: "text-white bg-blue-500",
                  accent: "text-blue-700",
                },
                conservative: {
                  bg: "bg-green-50/60",
                  border: "border-green-200",
                  pill: "text-white bg-green-600",
                  accent: "text-green-700",
                },
                custom: {
                  bg: "bg-purple-50/60",
                  border: "border-purple-200",
                  pill: "text-white bg-purple-500",
                  accent: "text-purple-700",
                },
              };
              const ps = presetBar[si.preset] ?? presetBar["default"]!;
              return (
                <div
                  className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border px-4 py-2.5 ${ps.bg} ${ps.border}`}
                >
                  <span
                    className={`px-2 py-0.5 rounded-md font-bold uppercase tracking-wider text-[10px] shadow-sm ${ps.pill}`}
                  >
                    {si.presetLabel}
                  </span>
                  <div className="flex items-center gap-3 text-xs text-muted">
                    <div className="text-center">
                      <div className="font-semibold tabular-nums">
                        {formatPercent(si.blendedReturn, 2)}
                      </div>
                      <div className="text-[9px] text-faint">return</div>
                      <div className="text-[8px] text-faint">5–10%</div>
                    </div>
                    <div className="text-center">
                      <div className="font-semibold tabular-nums">
                        {formatPercent(si.blendedVol, 2)}
                      </div>
                      <div className="text-[9px] text-faint">volatility</div>
                      <div className="text-[8px] text-faint">8–16%</div>
                    </div>
                    <div className="text-center">
                      <div className="font-semibold tabular-nums">
                        {formatPercent(si.withdrawalRate, 2)}
                      </div>
                      <div className="text-[9px] text-faint">
                        {si.withdrawalStrategy &&
                        si.withdrawalStrategy !== "fixed"
                          ? "initial rate"
                          : "withdrawal"}
                      </div>
                      <div className="text-[8px] text-faint">3–4%</div>
                    </div>
                    <div className="text-center">
                      <div className="font-semibold tabular-nums">
                        {formatPercent(si.inflationRisk.meanRate, 2)}
                      </div>
                      <div className="text-[9px] text-faint">inflation</div>
                      <div className="text-[8px] text-faint">2–3%</div>
                    </div>
                    <div className="text-center">
                      <div className="font-semibold tabular-nums">
                        {mcr.numTrials.toLocaleString()}
                      </div>
                      <div className="text-[9px] text-faint">trials</div>
                      <div className="text-[8px] text-faint">1K+</div>
                    </div>
                  </div>
                  {(si.taxMode === "advanced" || si.hasAssetClassOverrides) && (
                    <>
                      <div className="w-px h-6 bg-gray-300/60" />
                      <div className="flex items-center gap-2 text-[10px]">
                        {si.taxMode === "advanced" && (
                          <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-medium">
                            Tax-aware
                          </span>
                        )}
                        {si.hasAssetClassOverrides && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
                            Overrides
                          </span>
                        )}
                      </div>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowAssumptions(true)}
                    className={`ml-auto px-3 py-1.5 rounded-md text-[11px] font-semibold border shadow-sm transition-colors ${ps.border} ${ps.accent} hover:bg-surface-primary/80`}
                  >
                    View Assumptions &rarr;
                  </button>
                </div>
              );
            })()}
        </>
      )}
      {!mcQuery.data?.result && !mcLoading && !mcQuery.error && (
        <div className="text-sm text-muted py-4">
          No Monte Carlo data available. Ensure asset classes and glide path are
          configured.
        </div>
      )}
    </div>
  );
}
