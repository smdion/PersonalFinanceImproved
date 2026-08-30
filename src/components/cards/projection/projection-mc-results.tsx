"use client";

/** Monte Carlo results — loading spinner, errors, warnings, depletion callout, and compact summary bar. */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { HelpTip } from "@/components/ui/help-tip";
import { toast } from "@/lib/hooks/use-toast";
import { ControlZone } from "./pill-btn";
import {
  formatCurrency,
  formatPercent,
  formatRelativeTime,
} from "@/lib/utils/format";
import type { ProjectionState } from "./projection-table-types";

/** Compact depletion callout (1-liner) shown when MC has a depletion age. */
export function McDepletionCallout({ state }: { state: ProjectionState }) {
  // Check via `state.result` before destructuring — result truthy always
  // implies engineSettings defined (see use-projection-derived.ts).
  if (!state.result) return null;

  const { result, engineSettings, deflate, baseYear, mcQuery, mcLoading } =
    state;

  if (!mcQuery.data?.result || mcLoading) return null;
  if (!mcQuery.data.result.distributions.depletionAge) return null;

  const mc = mcQuery.data.result;
  const terminalYear =
    baseYear + (engineSettings.endAge - (result.projectionByYear[0]?.age ?? 0));
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
export function McResultsSection({ state }: { state: ProjectionState }) {
  const {
    result,
    projectionMode,
    mcLoading,
    mcQuery,
    setShowAssumptions,
    runMonteCarlo,
    runCoastFireMc,
    clearProjectionCacheMutation,
  } = state;
  const [isRerunning, setIsRerunning] = useState(false);
  const utils = trpc.useUtils();

  if (projectionMode !== "monteCarlo") return null;

  const handleRerun = async () => {
    setIsRerunning(true);
    try {
      // Refresh both cache-backed simulations shown on this page together —
      // the baseline MC bar here and the Coast FIRE hero card both read from
      // the persistent projection cache, so a "re-run" should mean "give me
      // fresh randomness for both," not just one of the two.
      await Promise.all([runMonteCarlo(), runCoastFireMc()]);
    } finally {
      setIsRerunning(false);
    }
  };

  const handleClearCache = () => {
    // Whole-table wipe (no per-household scoping column exists) — confirm
    // since it affects every cached projection, not just this page's.
    if (
      !window.confirm(
        "Clear all cached projection results? Every projection page will recompute on next load.",
      )
    ) {
      return;
    }
    clearProjectionCacheMutation.mutate(undefined, {
      onSuccess: (data) => {
        toast(`Cleared ${data.cleared} cached row(s).`, "success");
        // Wiping the SERVER-side projection_cache table alone doesn't touch
        // this browser tab's own client-side query cache -- without this,
        // "Clear Cache" clears the wrong side: the server would compute
        // fresh on its NEXT request, but nothing tells this tab to actually
        // make that next request, so the table keeps showing whatever
        // computeProjection response it already has in memory. Found
        // 2026-08-29 debugging a live household where a Bracket Ceiling
        // change genuinely persisted and genuinely changed the engine's
        // output, but "Clear Cache" alone never made the page reflect it.
        void utils.projection.invalidate();
      },
      onError: (err) => {
        toast(`Failed to clear cache: ${err.message}`, "error");
      },
    });
  };

  return (
    <div className="space-y-3">
      {/* MC loading state is handled by the unified ProjectionLoader slim strip */}
      {mcQuery.error && (
        <div className="text-sm text-red-500 py-4">
          Simulation failed: {mcQuery.error.message}
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

              // Guyton-Klinger's actual starting rate (not the flat
              // "Initial Withdrawal Rate" setting) — captured once, on the
              // first decumulation year, as that year's spending ÷ the
              // portfolio balance carried in from the last accumulation
              // year. GK uses this number (not si.withdrawalRate) to decide
              // every future raise/cut. Computed here from the same
              // deterministic result already loaded for the chart/table —
              // no new query.
              let gkImpliedRate: number | null = null;
              if (si.withdrawalStrategy === "guyton_klinger" && result) {
                const years = result.projectionByYear;
                for (let i = 0; i < years.length; i++) {
                  const y = years[i]!;
                  if (y.phase === "decumulation") {
                    const priorEnd = i > 0 ? years[i - 1]!.endBalance : null;
                    if (priorEnd != null && priorEnd > 0) {
                      gkImpliedRate = y.projectedExpenses / priorEnd;
                    }
                    break;
                  }
                }
              }

              const presetBar: Record<
                string,
                {
                  border: string;
                  pill: string;
                  accent: string;
                }
              > = {
                aggressive: {
                  border: "border-red-200",
                  pill: "text-white bg-red-500",
                  accent: "text-red-700",
                },
                default: {
                  border: "border-blue-200",
                  pill: "text-white bg-blue-500",
                  accent: "text-blue-700",
                },
                conservative: {
                  border: "border-green-200",
                  pill: "text-white bg-green-600",
                  accent: "text-green-700",
                },
                custom: {
                  border: "border-purple-200",
                  pill: "text-white bg-purple-500",
                  accent: "text-purple-700",
                },
              };
              const ps = presetBar[si.preset] ?? presetBar["default"]!;
              return (
                <ControlZone
                  tone="results"
                  title="Simulation"
                  why="what was run"
                >
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-md font-bold uppercase tracking-wider text-caption shadow-sm ${ps.pill}`}
                      >
                        {si.presetLabel}
                      </span>
                      {si.taxMode === "advanced" && (
                        <span className="px-1.5 py-0.5 rounded text-caption bg-orange-100 text-orange-700 font-medium">
                          Tax-aware
                        </span>
                      )}
                      {si.hasAssetClassOverrides && (
                        <span className="px-1.5 py-0.5 rounded text-caption bg-amber-100 text-amber-700 font-medium">
                          Overrides
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted">
                      <div className="text-center">
                        <div className="font-semibold tabular-nums">
                          {formatPercent(si.blendedReturn, 2)}
                        </div>
                        <div className="text-micro text-faint">return</div>
                        <div className="text-micro text-faint">5–10%</div>
                      </div>
                      <div className="text-center">
                        <div className="font-semibold tabular-nums">
                          {formatPercent(si.blendedVol, 2)}
                        </div>
                        <div className="text-micro text-faint">volatility</div>
                        <div className="text-micro text-faint">8–16%</div>
                      </div>
                      <div className="text-center">
                        <div className="font-semibold tabular-nums flex items-center justify-center gap-0.5">
                          {gkImpliedRate != null
                            ? formatPercent(gkImpliedRate, 2)
                            : formatPercent(si.withdrawalRate, 2)}
                          {gkImpliedRate != null && (
                            <HelpTip
                              maxWidth={260}
                              text={`Your Retirement Budget doesn't set a rate directly — Guyton-Klinger captures ${formatPercent(gkImpliedRate, 2)} on your first retirement year (that year's spending ÷ your projected portfolio balance) and defends THIS rate with guardrails for the rest of retirement. It's not the "Initial Withdrawal Rate" setting (${formatPercent(si.withdrawalRate, 2)}) — that field is never read by any strategy, including this one.`}
                            />
                          )}
                        </div>
                        {/* R45 Step 3, Finding 4 (base case) + this session
                          (GK case): for every other strategy this is still
                          the flat "Initial Withdrawal Rate" household
                          setting, an input echo like the return/volatility/
                          inflation figures beside it — not what any
                          strategy's spending math reads (Finding 0). For
                          Guyton-Klinger specifically, it's replaced with the
                          rate GK actually captured and will defend — a real
                          number, not a reference figure — since a user
                          could otherwise read "ref. rate" here and
                          reasonably ask why GK's spending seems to track it
                          anyway. */}
                        <div className="text-micro text-faint">
                          {gkImpliedRate != null
                            ? "GK anchor rate"
                            : "ref. rate"}
                        </div>
                        <div className="text-micro text-faint">
                          {gkImpliedRate != null
                            ? "captured, not chosen"
                            : "3–5%"}
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="font-semibold tabular-nums">
                          {formatPercent(si.inflationRisk.meanRate, 2)}
                        </div>
                        <div className="text-micro text-faint">inflation</div>
                        <div className="text-micro text-faint">2–3%</div>
                      </div>
                      <div className="text-center">
                        <div className="font-semibold tabular-nums">
                          {mcr.numTrials.toLocaleString()}
                        </div>
                        <div className="text-micro text-faint">trials</div>
                        <div className="text-micro text-faint">1K+</div>
                      </div>
                    </div>
                    {/* Explicit full-width fallback below the ~1024px point
                      where this bar (sidebar + card padding, not raw
                      viewport width) actually runs out of room — without
                      it, this cluster squeezes between the stat blocks
                      instead of dropping to its own clean row (live-user
                      finding, 2026-08-29). */}
                    <div className="basis-full ml-auto lg:basis-auto flex items-center justify-end gap-3">
                      {si.computedAt && (
                        <div className="text-center">
                          <div className="font-semibold tabular-nums text-xs whitespace-nowrap">
                            {formatRelativeTime(si.computedAt)}
                          </div>
                          <div className="text-micro text-faint">last run</div>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={handleRerun}
                        disabled={isRerunning}
                        className="px-3 py-1.5 rounded-md text-label font-semibold border border-subtle text-muted shadow-sm transition-colors hover:bg-surface-primary/80 disabled:opacity-50"
                      >
                        {isRerunning ? "Running…" : "Re-run"}
                      </button>
                      <button
                        type="button"
                        onClick={handleClearCache}
                        disabled={clearProjectionCacheMutation.isPending}
                        className="px-3 py-1.5 rounded-md text-label font-semibold border border-subtle text-muted shadow-sm transition-colors hover:bg-surface-primary/80 disabled:opacity-50"
                      >
                        {clearProjectionCacheMutation.isPending
                          ? "Clearing…"
                          : "Clear Cache"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowAssumptions(true)}
                        className={`px-3 py-1.5 rounded-md text-label font-semibold border shadow-sm transition-colors ${ps.border} ${ps.accent} hover:bg-surface-primary/80`}
                      >
                        View Assumptions &rarr;
                      </button>
                    </div>
                  </div>
                </ControlZone>
              );
            })()}
        </>
      )}
      {!mcQuery.data?.result && !mcLoading && !mcQuery.error && (
        <div className="text-sm text-muted py-4">
          No simulation data available. Ensure asset classes and glide path are
          configured.
        </div>
      )}
    </div>
  );
}
