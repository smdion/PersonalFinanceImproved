"use client";

/** Top-level ProjectionCard component — orchestrates the projection state hook and delegates to sub-components. */
import { useEffect } from "react";
import dynamic from "next/dynamic";
import { HelpTip } from "@/components/ui/help-tip";
import { SlidePanel } from "@/components/ui/slide-panel";
import { MethodologyContent } from "@/components/methodology-content";
import { AccumulationMethodologyContent } from "@/components/accumulation-methodology-content";
import { DecumulationMethodologyContent } from "@/components/decumulation-methodology-content";
import { ValidationContent } from "@/components/validation-content";
// formatCurrency import removed — no longer used inline
import { SimulationAssumptions } from "@/components/cards/mc-simulation-assumptions";
import { DecumulationConfig } from "./decumulation-config";
import { OverridesPanelV2 as OverridesPanel } from "./overrides-panel-v2";
import { ProjectionTable } from "./projection-table";
import { ProjectionHeroKpis } from "./projection-hero-kpis";
import { ProjectionChartSkeleton } from "./projection-chart-skeleton";
import { ProjectionTableSkeleton } from "./projection-table-skeleton";

// Code-split Recharts-heavy children (v0.5 expert-review M8). Each chart is
// ~250KB of recharts payload that loads only when the projection card mounts.
// ssr:false because Recharts isn't SSR-friendly.
const ProjectionChart = dynamic(
  () =>
    import("./projection-chart").then((m) => ({ default: m.ProjectionChart })),
  { loading: () => <ProjectionChartSkeleton />, ssr: false },
);
const SpendingStabilityChart = dynamic(
  () =>
    import("./spending-stability-chart").then((m) => ({
      default: m.SpendingStabilityChart,
    })),
  { loading: () => <ProjectionChartSkeleton />, ssr: false },
);
import { McResultsSection } from "./projection-mc-results";
import { ProjectionLoader } from "./projection-loader";
import {
  useProjectionState,
  type EngineContribRate,
} from "./use-projection-state";

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export { type EngineContribRate } from "./use-projection-state";

export function ProjectionCard(props: {
  people?: { id: number; name: string; birthYear: number }[];
  onContributionRates?: (rates: EngineContribRate[]) => void;
  withdrawalRate: number;
  accumulationBudgetProfileId?: number;
  accumulationBudgetColumn?: number;
  accumulationExpenseOverride?: number;
  decumulationBudgetProfileId?: number;
  decumulationBudgetColumn?: number;
  decumulationExpenseOverride?: number;
  parentCategoryFilter?: string;
  contributionProfileId?: number;
  snapshotId?: number;
  /** When provided, overrides the internal dollarMode state (for shared page-level toggle). */
  dollarMode?: "nominal" | "real";
  onDollarModeChange?: (mode: "nominal" | "real") => void;
}) {
  const s = useProjectionState({
    people: props.people,
    onContributionRates: props.onContributionRates,
    withdrawalRate: props.withdrawalRate,
    accumulationBudgetProfileId: props.accumulationBudgetProfileId,
    accumulationBudgetColumn: props.accumulationBudgetColumn,
    accumulationExpenseOverride: props.accumulationExpenseOverride,
    decumulationBudgetProfileId: props.decumulationBudgetProfileId,
    decumulationBudgetColumn: props.decumulationBudgetColumn,
    decumulationExpenseOverride: props.decumulationExpenseOverride,
    parentCategoryFilter: props.parentCategoryFilter,
    contributionProfileId: props.contributionProfileId,
    snapshotId: props.snapshotId,
  });

  // Destructure for the toolbar and stats row (kept inline since they're tightly coupled to layout)
  const {
    withdrawalRoutingMode,
    setWithdrawalRoutingMode,
    withdrawalOrder,
    setWithdrawalOrder,
    withdrawalSplits,
    setWithdrawalSplits,
    withdrawalTaxPref,
    setWithdrawalTaxPref,
    projectionMode,
    // setProjectionMode removed — MC is always active
    mcTrials,
    setMcTrials,
    mcPreset,
    setMcPreset,
    mcTaxMode,
    setMcTaxMode,
    mcAssetClassOverrides,
    setMcAssetClassOverrides,
    dollarMode: internalDollarMode,
    setDollarMode: internalSetDollarMode,
    chartView,
    fanBandRange,
    showMethodology,
    setShowMethodology,
    showAccumMethodology,
    setShowAccumMethodology,
    showDecumMethodology,
    setShowDecumMethodology,
    showValidation,
    setShowValidation,
    showAssumptions,
    setShowAssumptions,
    showDecumConfig,
    setShowDecumConfig,
    personFilter,
    setPersonFilter,
    isPersonFiltered,
    updateGlidePath,
    updateInflationRisk,
    updateClampBounds,
    updateAssetClassOverrides,
    updateInflationOverrides,
    engineQuery,
    mcPrefetchQuery,
    mcQuery,
    personFilterName,
    mcChartPending,
    result,
    enginePeople,
    engineSettings,
    baseYear,
    deflate,
    autoloadEnabled,
    runSimulation,
    mcAutoloadEnabled,
    runMonteCarlo,
    coastFireMcAutoloadEnabled,
    runCoastFireMc,
    coastFireMcQuery,
  } = s;

  // Allow page-level dollarMode override (for shared toggle across tabs).
  // Sync the prop into internal state so derived data (deflate) reads the correct value.
  const dollarMode = props.dollarMode ?? internalDollarMode;
  const setDollarMode = props.onDollarModeChange ?? internalSetDollarMode;
  useEffect(() => {
    if (
      props.dollarMode !== undefined &&
      props.dollarMode !== internalDollarMode
    ) {
      internalSetDollarMode(props.dollarMode);
    }
  }, [props.dollarMode, internalDollarMode, internalSetDollarMode]);

  const {
    parentCategoryFilter,
    people,
    accumulationBudgetProfileId,
    accumulationBudgetColumn,
    accumulationExpenseOverride,
    decumulationBudgetProfileId,
    decumulationBudgetColumn,
    decumulationExpenseOverride,
  } = props;

  return (
    <>
      <div className="space-y-6 mb-6">
        <div className="space-y-6">
          {/* ================================================================= */}
          {/* RESULTS */}
          {/* ================================================================= */}

          {engineQuery.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              Failed to run engine: {engineQuery.error.message}
            </div>
          )}

          {/* ── CONTENT BLOCK ────────────────────────────────────────────────
               Every section renders a skeleton or real content at the SAME
               DOM position so the layout never shifts during loading. */}
          {(engineQuery.isLoading || !!result) && (
            <div className="space-y-4">
              {/* Hero KPIs — skeleton during engine load, real once data arrives */}
              {engineQuery.isLoading ? (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="min-h-[128px] animate-pulse rounded-lg border border-subtle bg-surface-primary/40 p-3"
                      style={{
                        animationDelay: `${i * 80}ms`,
                        animationDuration: "1.8s",
                      }}
                    >
                      <div className="h-2.5 w-20 rounded bg-surface-strong/20" />
                      <div className="mt-4 h-8 w-24 rounded bg-surface-strong/20" />
                      <div className="mt-2 h-2 w-16 rounded bg-surface-strong/20" />
                    </div>
                  ))}
                </div>
              ) : (
                <ProjectionHeroKpis s={s} />
              )}

              {/* MC auto-load disabled notice — only when real data */}
              {result && !mcAutoloadEnabled && !mcPrefetchQuery.data && (
                <div className="flex items-center justify-between rounded-lg border border-subtle bg-surface-sunken px-3 py-2">
                  <span className="text-xs text-muted">
                    Monte Carlo auto-load is off — chart bands unavailable.
                  </span>
                  <button
                    onClick={() => runMonteCarlo()}
                    className="text-xs text-blue-500 hover:text-blue-400 font-medium"
                  >
                    Run Monte Carlo
                  </button>
                </div>
              )}

              {/* MC assumptions summary — only when real data */}
              {result && <McResultsSection s={s} />}

              {/* Toolbar — skeleton during engine load, real controls once data arrives */}
              {engineQuery.isLoading ? (
                <div
                  className="h-[70px] animate-pulse rounded-lg bg-surface-sunken"
                  style={{ animationDuration: "1.8s" }}
                />
              ) : null}

              {/* Unified toolbar — two rows (only when real data) */}
              {result &&
                (() => {
                  const pillBtn = (
                    active: boolean,
                    onClick: () => void,
                    label: string,
                    key?: string,
                  ) => (
                    <button
                      key={key ?? label}
                      type="button"
                      onClick={onClick}
                      className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                        active
                          ? "bg-surface-primary text-primary shadow-sm border"
                          : "text-muted hover:text-secondary"
                      }`}
                    >
                      {label}
                    </button>
                  );
                  const pp = people ?? enginePeople;
                  const isMc = projectionMode === "monteCarlo";
                  return (
                    <div className="bg-surface-sunken rounded-lg px-3 py-2 space-y-1.5">
                      {/* Row 1: VIEW | PROJECTION | DOLLARS */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        {/* Person filter */}
                        {pp && pp.length > 1 && (
                          <>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-faint font-medium uppercase">
                                View
                              </span>
                              <div className="inline-flex rounded-md border bg-surface-primary/60 p-0.5">
                                {pillBtn(
                                  personFilter === "all",
                                  () => setPersonFilter("all"),
                                  "Joint",
                                )}
                                {pp.map((p) =>
                                  pillBtn(
                                    personFilter === p.id,
                                    () => setPersonFilter(p.id),
                                    p.name,
                                  ),
                                )}
                              </div>
                            </div>
                            <div className="w-px h-4 bg-surface-strong" />
                          </>
                        )}
                        {/* Projection mode */}
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-faint font-medium uppercase">
                            Projection
                            <HelpTip
                              maxWidth={420}
                              lines={[
                                <span key="det">
                                  <strong className="text-blue-300">
                                    Deterministic
                                  </strong>{" "}
                                  — Single fixed-rate projection using your
                                  configured return rates. Shows one possible
                                  future, no randomness.
                                </span>,
                                <span key="agg">
                                  <strong className="text-red-300">
                                    Aggressive
                                  </strong>{" "}
                                  — Full historical returns, 0.9× vol, high
                                  equity (95%→35%). Money Guy / Bogleheads
                                  &quot;age - 20&quot; bonds rule.
                                </span>,
                                <span key="def">
                                  <strong className="text-green-300">
                                    Default
                                  </strong>{" "}
                                  — Historical returns, standard vol, hybrid
                                  FIRE glide path (90%→50% floor). Vanguard TDF
                                  accumulation + Kitces rising equity.
                                </span>,
                                <span key="con">
                                  <strong className="text-amber-300">
                                    Conservative
                                  </strong>{" "}
                                  — Forward-looking returns (~5% equity), +15%
                                  vol, heavy bonds (75%→15%). Vanguard VCMM / JP
                                  Morgan LTCMA.
                                </span>,
                                <span key="cus">
                                  <strong className="text-purple-300">
                                    Custom
                                  </strong>{" "}
                                  — Raw DB values for returns, volatility, and
                                  glide path. No preset adjustments — edit
                                  asset_class_params and glide_path_allocations
                                  directly.
                                </span>,
                              ]}
                            />
                          </span>
                          {isMc && (
                            <>
                              <select
                                value={mcPreset}
                                onChange={(e) =>
                                  setMcPreset(e.target.value as typeof mcPreset)
                                }
                                className="text-[10px] h-6 px-1.5 rounded border bg-surface-primary text-muted cursor-pointer"
                                title="Simulation preset"
                              >
                                <option value="aggressive">Aggressive</option>
                                <option value="default">Default</option>
                                <option value="conservative">
                                  Conservative
                                </option>
                                <option value="custom">Custom</option>
                              </select>
                              <select
                                value={mcTrials}
                                onChange={(e) =>
                                  setMcTrials(Number(e.target.value))
                                }
                                className="text-[10px] h-6 px-1.5 rounded border bg-surface-primary text-muted cursor-pointer"
                                title="Number of simulation trials"
                              >
                                <option value={500}>500 trials</option>
                                <option value={1000}>1,000 trials</option>
                                <option value={2500}>2,500 trials</option>
                                <option value={5000}>5,000 trials</option>
                              </select>
                              <div className="inline-flex rounded-md border bg-surface-primary/60 p-0.5">
                                {pillBtn(
                                  mcTaxMode === "simple",
                                  () => setMcTaxMode("simple"),
                                  "Simple",
                                )}
                                {pillBtn(
                                  mcTaxMode === "advanced",
                                  () => setMcTaxMode("advanced"),
                                  "Advanced",
                                )}
                              </div>
                              <HelpTip
                                maxWidth={360}
                                lines={[
                                  <span key="simple">
                                    <strong className="text-blue-300">
                                      Simple
                                    </strong>{" "}
                                    — Single portfolio, no tax. Comparable to
                                    cFIREsim/FireCalc.
                                  </span>,
                                  <span key="advanced">
                                    <strong className="text-orange-300">
                                      Advanced
                                    </strong>{" "}
                                    — Full multi-account tax-aware simulation
                                    with gross-up and bracket filling.
                                  </span>,
                                ]}
                              />
                              <button
                                type="button"
                                onClick={() => setShowMethodology(true)}
                                className="text-[10px] text-blue-500 hover:text-blue-600 underline whitespace-nowrap"
                              >
                                How does this work?
                              </button>
                            </>
                          )}
                        </div>
                        <div className="w-px h-4 bg-surface-strong" />
                        {/* Dollar mode */}
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-faint font-medium uppercase">
                            Dollars
                            <HelpTip
                              maxWidth={400}
                              lines={[
                                <div key="today" className="space-y-1">
                                  <div>
                                    <strong className="text-blue-300">
                                      Today&apos;s $
                                    </strong>{" "}
                                    <span className="text-faint">
                                      (default)
                                    </span>
                                  </div>
                                  <div className="text-faint text-xs">
                                    Removes inflation — every dollar means the
                                    same as it does right now. A $100k balance
                                    in 2050 shows what that money actually buys
                                    today.
                                  </div>
                                  <div className="text-xs text-faint mt-0.5">
                                    Use when:
                                  </div>
                                  <ul
                                    className="text-xs text-faint ml-3 space-y-0.5"
                                    style={{ listStyleType: "'▸ '" }}
                                  >
                                    <li>
                                      <span className="text-blue-300/80">
                                        Will I have enough to retire?
                                      </span>
                                    </li>
                                    <li>
                                      Comparing your nest egg to your{" "}
                                      <em>current</em> salary
                                    </li>
                                    <li>
                                      Checking if withdrawals cover today&apos;s
                                      expenses
                                    </li>
                                    <li>
                                      Evaluating whether savings rate keeps up
                                    </li>
                                    <li>Comparing scenarios across decades</li>
                                  </ul>
                                  <div className="text-[10px] text-muted italic mt-0.5">
                                    Salary and withdrawals may appear flat or
                                    declining — that&apos;s not a bug, it means
                                    purchasing power isn&apos;t outpacing
                                    inflation.
                                  </div>
                                </div>,
                                <div
                                  key="future"
                                  className="space-y-1 border-t pt-1.5"
                                >
                                  <div>
                                    <strong className="text-green-300">
                                      Future $
                                    </strong>
                                  </div>
                                  <div className="text-faint text-xs">
                                    Actual dollar amounts as they&apos;ll appear
                                    on statements, tax forms, and paychecks.
                                    Numbers grow larger because they include
                                    inflation.
                                  </div>
                                  <div className="text-xs text-faint mt-0.5">
                                    Use when:
                                  </div>
                                  <ul
                                    className="text-xs text-faint ml-3 space-y-0.5"
                                    style={{ listStyleType: "'▸ '" }}
                                  >
                                    <li>
                                      Checking if you&apos;ll hit{" "}
                                      <span className="text-green-300/80">
                                        401k/IRA contribution limits
                                      </span>
                                    </li>
                                    <li>
                                      Planning{" "}
                                      <span className="text-green-300/80">
                                        Roth conversions
                                      </span>{" "}
                                      against tax brackets
                                    </li>
                                    <li>
                                      Estimating{" "}
                                      <span className="text-green-300/80">
                                        RMD amounts
                                      </span>
                                    </li>
                                    <li>
                                      Seeing what your account balance will
                                      actually read
                                    </li>
                                    <li>
                                      Modeling{" "}
                                      <span className="text-green-300/80">
                                        IRMAA thresholds
                                      </span>
                                    </li>
                                    <li>Filing-year tax projections</li>
                                  </ul>
                                </div>,
                                <div
                                  key="tip"
                                  className="border-t pt-1.5 text-xs text-faint italic"
                                >
                                  Same projection, different lens.{" "}
                                  <span className="text-blue-300">
                                    Today&apos;s $
                                  </span>{" "}
                                  answers{" "}
                                  <strong className="text-faint">
                                    &quot;is this enough?&quot;
                                  </strong>{" "}
                                  —{" "}
                                  <span className="text-green-300">
                                    Future $
                                  </span>{" "}
                                  answers{" "}
                                  <strong className="text-faint">
                                    &quot;what will the statement say?&quot;
                                  </strong>
                                </div>,
                              ]}
                            />
                          </span>
                          <div className="inline-flex rounded-md border bg-surface-primary/60 p-0.5">
                            {pillBtn(
                              dollarMode === "real",
                              () => setDollarMode("real"),
                              "Today's $",
                            )}
                            {pillBtn(
                              dollarMode === "nominal",
                              () => setDollarMode("nominal"),
                              "Future $",
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

              {/* Chart area — engine skeleton, then real chart (with MC skeleton
                  if MC is still pending after engine completes) */}
              {engineQuery.isLoading ? (
                <ProjectionChartSkeleton phase="engine" />
              ) : chartView === "strategy" || chartView === "budget" ? (
                <SpendingStabilityChart s={s} view={chartView} />
              ) : mcChartPending && chartView === "balance" ? (
                <ProjectionChartSkeleton phase="simulation" />
              ) : (
                <ProjectionChart s={s} />
              )}
            </div>
          )}

          {/* LOADER — full skeleton card during engine loading / action state;
              slim progress strip during MC-only loading (real content visible above) */}
          {(() => {
            const enginePhase = engineQuery.isLoading
              ? ("active" as const)
              : engineQuery.isSuccess
                ? ("done" as const)
                : ("pending" as const);

            const mcInitialLoading =
              !mcPrefetchQuery.data && mcPrefetchQuery.isFetching;
            const mcPhase = !mcAutoloadEnabled
              ? ("disabled" as const)
              : mcInitialLoading
                ? ("active" as const)
                : mcPrefetchQuery.data
                  ? ("done" as const)
                  : ("pending" as const);

            const coastFireMcPhase = !coastFireMcAutoloadEnabled
              ? ("disabled" as const)
              : coastFireMcQuery.isLoading || coastFireMcQuery.isFetching
                ? ("active" as const)
                : coastFireMcQuery.data
                  ? ("done" as const)
                  : ("pending" as const);

            const showActionState =
              !autoloadEnabled && !engineQuery.data && !engineQuery.isLoading;

            return (
              <ProjectionLoader
                enginePhase={enginePhase}
                mcPhase={mcPhase}
                coastFireMcPhase={coastFireMcPhase}
                showActionState={showActionState}
                onRunSimulation={runSimulation}
                onRunMonteCarlo={runMonteCarlo}
                onRunCoastFireMc={runCoastFireMc}
              />
            );
          })()}

          {/* TABLE — skeleton while engine is loading or in action state,
              real table otherwise. Same DOM position always. */}
          {engineQuery.isLoading || (!autoloadEnabled && !engineQuery.data) ? (
            <ProjectionTableSkeleton />
          ) : (
            <ProjectionTable
              state={s}
              people={people}
              parentCategoryFilter={parentCategoryFilter}
              accumulationBudgetProfileId={accumulationBudgetProfileId}
              accumulationBudgetColumn={accumulationBudgetColumn}
              accumulationExpenseOverride={accumulationExpenseOverride}
              decumulationBudgetProfileId={decumulationBudgetProfileId}
              decumulationBudgetColumn={decumulationBudgetColumn}
              decumulationExpenseOverride={decumulationExpenseOverride}
            />
          )}

          {/* DECUMULATION DEFAULTS */}
          <DecumulationConfig
            isPersonFiltered={isPersonFiltered}
            personFilterName={personFilterName}
            showDecumConfig={showDecumConfig}
            setShowDecumConfig={setShowDecumConfig}
            withdrawalRoutingMode={withdrawalRoutingMode}
            setWithdrawalRoutingMode={setWithdrawalRoutingMode}
            withdrawalOrder={withdrawalOrder}
            setWithdrawalOrder={setWithdrawalOrder}
            withdrawalSplits={withdrawalSplits}
            setWithdrawalSplits={setWithdrawalSplits}
            withdrawalTaxPref={withdrawalTaxPref}
            setWithdrawalTaxPref={setWithdrawalTaxPref}
            activeSpendingStrategy={engineSettings?.withdrawalStrategy}
          />

          {/* UNIFIED OVERRIDES */}
          <OverridesPanel
            state={s}
            accumulationExpenseOverride={accumulationExpenseOverride}
          />
        </div>
      </div>
      <SlidePanel
        open={showMethodology}
        onClose={() => setShowMethodology(false)}
        title="Monte Carlo Methodology"
      >
        <MethodologyContent />
      </SlidePanel>
      <SlidePanel
        open={showAccumMethodology}
        onClose={() => setShowAccumMethodology(false)}
        title="Accumulation Methodology"
      >
        <AccumulationMethodologyContent />
      </SlidePanel>
      <SlidePanel
        open={showDecumMethodology}
        onClose={() => setShowDecumMethodology(false)}
        title="Decumulation Methodology"
      >
        <DecumulationMethodologyContent />
      </SlidePanel>
      <SlidePanel
        open={showValidation}
        onClose={() => setShowValidation(false)}
        title="Why Trust These Numbers?"
      >
        <ValidationContent />
      </SlidePanel>
      <SlidePanel
        open={showAssumptions}
        onClose={() => setShowAssumptions(false)}
        title="Simulation Assumptions"
      >
        {mcQuery.data?.result &&
          "simulationInputs" in mcQuery.data &&
          mcQuery.data.simulationInputs && (
            <SimulationAssumptions
              inputs={mcQuery.data.simulationInputs}
              numTrials={mcQuery.data.result.numTrials}
              onAssetClassOverridesChange={(overrides) => {
                setMcAssetClassOverrides(overrides);
                updateAssetClassOverrides.mutate(overrides);
              }}
              assetClassOverrides={mcAssetClassOverrides}
              fanBandRange={fanBandRange}
              onGlidePathChange={(entries) =>
                updateGlidePath.mutate({ entries })
              }
              onInflationRiskChange={(meanRate, stdDev) => {
                updateInflationRisk.mutate({
                  preset: mcPreset,
                  inflationMean: meanRate,
                  inflationStdDev: stdDev,
                });
                updateInflationOverrides.mutate({ meanRate, stdDev });
              }}
              onClampBoundsChange={(min, max) =>
                updateClampBounds.mutate({
                  preset: "custom",
                  returnClampMin: min,
                  returnClampMax: max,
                })
              }
              outcomeDistribution={{
                successRate: mcQuery.data.result.successRate,
                medianEndBalance: mcQuery.data.result.medianEndBalance,
                p5EndBalance: mcQuery.data.result.worstCase.p5EndBalance,
                terminalBalance:
                  mcQuery.data.result.distributions.terminalBalance,
                sustainableWithdrawalPV:
                  mcQuery.data.result.distributions.sustainableWithdrawalPV,
                depletionAge:
                  mcQuery.data.result.distributions.depletionAge ?? undefined,
                computeTimeMs: mcQuery.data.result.computeTimeMs,
              }}
              deflate={(amount: number) => {
                const termYear =
                  baseYear +
                  (engineSettings!.endAge -
                    (result?.projectionByYear[0]?.age ?? 0));
                return deflate(amount, termYear);
              }}
            />
          )}
      </SlidePanel>
    </>
  );
}
