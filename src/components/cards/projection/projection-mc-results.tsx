"use client";

/** Monte Carlo results — loading spinner, errors, warnings, depletion callout, and compact summary bar. */
import { trpc } from "@/lib/trpc";
import { HelpTip } from "@/components/ui/help-tip";
import { Badge } from "@/components/ui/badge";
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
      <span className="shrink-0 font-medium">
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
    rerunAllMc,
    isRerunning,
    clearProjectionCacheMutation,
    deflate,
    dollarMode,
  } = state;
  const utils = trpc.useUtils();

  if (projectionMode !== "monteCarlo") return null;

  // Refreshes both cache-backed simulations shown on this page together —
  // the baseline MC bar here and the Coast FIRE hero card both read from
  // the persistent projection cache, so a "re-run" should mean "give me
  // fresh randomness for both," not just one of the two. `isRerunning`
  // lives in the shared state hook (not local to this component) so the
  // top-of-page "recalculating" banner and the chart/table skeleton in
  // index.tsx can also react to it — a manual re-run previously showed
  // neither, since it bypasses the query hooks' own isFetching entirely
  // (see rerunAllMc's docblock in use-projection-queries.ts).
  const handleRerun = rerunAllMc;

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
        <div className="py-4 text-sm text-red-500">
          Simulation failed: {mcQuery.error.message}
        </div>
      )}
      {mcQuery.data?.result && !mcLoading && (
        <>
          {/* MC warnings */}
          {mcQuery.data.result.warnings.length > 0 && (
            <div className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-600">
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

              // First decumulation year — the same year Guyton-Klinger's
              // anchor rate below is captured from, and also the source
              // for the "starting income" tile: `projectedExpenses` is the
              // ACTIVE strategy's own computed first-year spending (per
              // coast-fire.ts's docblock — for every strategy but the 4
              // budget-continuation ones this is real, strategy-computed
              // math, not an echo of a flat rate setting), so this reflects
              // whatever withdrawal strategy/override is actually driving
              // the household's plan, not si.withdrawalRate.
              let firstDecumYear:
                NonNullable<typeof result>["projectionByYear"][number] | null =
                null;
              let priorAccumEnd: number | null = null;
              if (result) {
                const years = result.projectionByYear;
                for (let i = 0; i < years.length; i++) {
                  const y = years[i]!;
                  if (y.phase === "decumulation") {
                    firstDecumYear = y;
                    priorAccumEnd = i > 0 ? years[i - 1]!.endBalance : null;
                    break;
                  }
                }
              }

              // Guyton-Klinger's actual starting rate (not the flat
              // "Initial Withdrawal Rate" setting) — that year's spending ÷
              // the portfolio balance carried in from the last accumulation
              // year. GK uses this number (not si.withdrawalRate) to decide
              // every future raise/cut.
              let gkImpliedRate: number | null = null;
              if (
                si.withdrawalStrategy === "guyton_klinger" &&
                firstDecumYear &&
                priorAccumEnd != null &&
                priorAccumEnd > 0
              ) {
                gkImpliedRate =
                  firstDecumYear.projectedExpenses / priorAccumEnd;
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
              // Asset mix behind the blended return/volatility tiles — same
              // weights (current glide-path allocation) for both, so one
              // description serves both tooltips.
              const mixLines = (si.assetClasses ?? [])
                .map((ac) => {
                  const w = (si.currentAllocation ?? {})[ac.id] ?? 0;
                  return w > 0
                    ? `${formatPercent(w, 0)} ${ac.name} (${formatPercent(ac.meanReturn, 1)} return, ${formatPercent(ac.stdDev, 1)} volatility)`
                    : null;
                })
                .filter((l): l is string => l !== null);
              return (
                <ControlZone
                  tone="results"
                  title="Simulation"
                  why="what was run"
                >
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-caption rounded-md px-2 py-0.5 font-bold tracking-wider uppercase shadow-sm ${ps.pill}`}
                      >
                        {si.presetLabel}
                      </span>
                      <HelpTip
                        maxWidth={280}
                        text={`${si.presetDescription} Every trial in this simulation draws from these same return/volatility/inflation assumptions — the withdrawal strategy below (${si.withdrawalStrategy.replace(/_/g, " ")}) only decides how much gets spent each year, not what the market does.`}
                      />
                      {si.taxMode === "advanced" && (
                        <span className="text-caption inline-flex items-center rounded bg-orange-100 px-1.5 py-0.5 font-medium text-orange-700">
                          Tax-aware
                          <HelpTip
                            maxWidth={260}
                            text="Advanced tax mode: every simulated trial tracks each account's own tax treatment (Traditional/Roth/HSA/brokerage) separately when computing withdrawals. Simple mode collapses these into one approximate balance instead, trading some precision for speed."
                          />
                        </span>
                      )}
                      {si.hasAssetClassOverrides && (
                        <Badge color="amber" size="sm" case="normal">
                          Overrides
                          <HelpTip
                            maxWidth={260}
                            text="One or more asset classes are using custom return/volatility figures instead of this preset's own values — the return, volatility, and asset-mix figures below already reflect the overridden numbers."
                          />
                        </Badge>
                      )}
                    </div>
                    <div className="text-muted flex items-center gap-3 text-xs">
                      <div className="text-center">
                        <div className="flex items-center justify-center gap-0.5 font-semibold tabular-nums">
                          {formatPercent(si.blendedReturn, 2)}
                          <HelpTip
                            maxWidth={280}
                            lines={[
                              "Blended expected annual return across your current glide-path allocation:",
                              ...(mixLines.length > 0
                                ? mixLines
                                : ["(no asset-class weights available)"]),
                              "Same for every trial and every withdrawal strategy — strategies decide how much gets spent, not how the portfolio itself performs. This shifts over time as your glide path shifts allocation with age.",
                            ]}
                          />
                        </div>
                        <div className="text-micro text-faint">return</div>
                        <div className="text-micro text-faint">5–10%</div>
                      </div>
                      <div className="text-center">
                        <div className="flex items-center justify-center gap-0.5 font-semibold tabular-nums">
                          {formatPercent(si.blendedVol, 2)}
                          <HelpTip
                            maxWidth={280}
                            lines={[
                              "Blended annual volatility (standard deviation of returns) across your current glide-path allocation:",
                              ...(mixLines.length > 0
                                ? mixLines
                                : ["(no asset-class weights available)"]),
                              "Higher volatility means a wider range of possible outcomes per trial — this is what actually creates the spread between a “bad luck” and “good luck” simulated future, same for every withdrawal strategy.",
                            ]}
                          />
                        </div>
                        <div className="text-micro text-faint">volatility</div>
                        <div className="text-micro text-faint">8–16%</div>
                      </div>
                      <div className="text-center">
                        <div className="flex items-center justify-center gap-0.5 font-semibold tabular-nums">
                          {gkImpliedRate != null
                            ? formatPercent(gkImpliedRate, 2)
                            : formatPercent(si.withdrawalRate, 2)}
                          {gkImpliedRate != null ? (
                            <HelpTip
                              maxWidth={260}
                              text={`Your Retirement Budget doesn't set a rate directly — Guyton-Klinger captures ${formatPercent(gkImpliedRate, 2)} on your first retirement year (that year's spending ÷ your projected portfolio balance) and defends THIS rate with guardrails for the rest of retirement. It's not the "Initial Withdrawal Rate" setting (${formatPercent(si.withdrawalRate, 2)}) — that field is never read by any strategy, including this one.`}
                            />
                          ) : (
                            <HelpTip
                              maxWidth={260}
                              text={`Your household's "Initial Withdrawal Rate" setting (${formatPercent(si.withdrawalRate, 2)}), shown here only as a reference figure — your active strategy (${si.withdrawalStrategy.replace(/_/g, " ")}) computes spending its own way and does NOT read this number.`}
                            />
                          )}
                        </div>
                        {/* For every other strategy this is still
                          the flat "Initial Withdrawal Rate" household
                          setting, an input echo like the return/volatility/
                          inflation figures beside it — not what any
                          strategy's spending math actually reads. For
                          Guyton-Klinger specifically, it's replaced with the
                          rate GK actually captured and will defend — a real
                          number, not a reference figure — since a user
                          could otherwise read "ref. rate" here and
                          reasonably ask why GK's spending seems to track it
                          anyway. The non-GK tooltip used to also name-drop
                          GK ("...which is what you'd see here if it were
                          active") as a preemptive explanation for THAT
                          comparison — but it showed unconditionally for
                          every other strategy too, so someone who's never
                          touched GK got a confusing, unprompted mention of
                          a strategy they're not using (live-user finding,
                          2026-08-30). Dropped; the "shown here only as a
                          reference figure" framing already covers why the
                          number exists without needing the GK aside. */}
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
                      {firstDecumYear && (
                        <div className="text-center">
                          <div className="flex items-center justify-center gap-0.5 font-semibold tabular-nums">
                            {formatCurrency(
                              deflate(
                                firstDecumYear.projectedExpenses,
                                firstDecumYear.year,
                              ),
                            )}
                            <HelpTip
                              maxWidth={260}
                              text={`Your ${firstDecumYear.year} retirement year's actual spending, as computed by your ACTIVE withdrawal strategy (${si.withdrawalStrategy.replace(/_/g, " ")}) and any customizations in effect that year -- not a flat rate applied to today's balance. Shown in ${dollarMode === "nominal" ? "future" : "today's"} dollars, matching the Dollars toggle above the chart.`}
                            />
                          </div>
                          <div className="text-micro text-faint">
                            starting income
                          </div>
                          <div className="text-micro text-faint">
                            {dollarMode === "nominal"
                              ? "future $"
                              : "today's $"}
                          </div>
                        </div>
                      )}
                      <div className="text-center">
                        <div className="flex items-center justify-center gap-0.5 font-semibold tabular-nums">
                          {formatPercent(si.inflationRisk.meanRate, 2)}
                          <HelpTip
                            maxWidth={280}
                            text={`Average assumed inflation rate, randomized per year within each trial (±${formatPercent(si.inflationRisk.stdDev, 2)} standard deviation) rather than held flat — some years run hotter, some cooler, same as real inflation history. This is the same input for every strategy, but strategies react to it differently: a fixed-dollar strategy raises spending with inflation every year regardless, while a guardrail strategy like "Forgo Inflation After Loss" can skip that year's raise after a bad market year specifically to protect the portfolio.`}
                          />
                        </div>
                        <div className="text-micro text-faint">inflation</div>
                        <div className="text-micro text-faint">2–3%</div>
                      </div>
                      <div className="text-center">
                        <div className="flex items-center justify-center gap-0.5 font-semibold tabular-nums">
                          {mcr.numTrials.toLocaleString()}
                          <HelpTip
                            maxWidth={280}
                            text="Number of independent simulated lifetimes run, each with its own randomized sequence of yearly returns and inflation. Your strategy's success rate is simply the share of these trials that never run out of money — more trials means a more stable estimate of that share, at the cost of slower simulation."
                          />
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
                    <div className="ml-auto flex basis-full items-center justify-end gap-3 lg:basis-auto">
                      {si.computedAt && (
                        <div className="text-center">
                          <div className="text-xs font-semibold whitespace-nowrap tabular-nums">
                            {formatRelativeTime(si.computedAt)}
                          </div>
                          <div className="text-micro text-faint">last run</div>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={handleRerun}
                        disabled={isRerunning}
                        className="text-label border-subtle text-muted hover:bg-surface-primary/80 rounded-md border px-3 py-1.5 font-semibold shadow-sm transition-colors disabled:opacity-50"
                      >
                        {isRerunning ? "Running…" : "Re-run"}
                      </button>
                      <button
                        type="button"
                        onClick={handleClearCache}
                        disabled={clearProjectionCacheMutation.isPending}
                        className="text-label border-subtle text-muted hover:bg-surface-primary/80 rounded-md border px-3 py-1.5 font-semibold shadow-sm transition-colors disabled:opacity-50"
                      >
                        {clearProjectionCacheMutation.isPending
                          ? "Clearing…"
                          : "Clear Cache"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowAssumptions(true)}
                        className={`text-label rounded-md border px-3 py-1.5 font-semibold shadow-sm transition-colors ${ps.border} ${ps.accent} hover:bg-surface-primary/80`}
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
        <div className="text-muted py-4 text-sm">
          No simulation data available. Ensure asset classes and glide path are
          configured.
        </div>
      )}
    </div>
  );
}
