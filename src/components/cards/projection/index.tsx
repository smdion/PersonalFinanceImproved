"use client";

/** Top-level ProjectionCard component — orchestrates the projection state hook and delegates to sub-components. */
import { Toggle } from "@/components/ui/toggle";
import { HelpTip } from "@/components/ui/help-tip";
import { SlidePanel } from "@/components/ui/slide-panel";
import { MethodologyContent } from "@/components/methodology-content";
import { AccumulationMethodologyContent } from "@/components/accumulation-methodology-content";
import { DecumulationMethodologyContent } from "@/components/decumulation-methodology-content";
import { ValidationContent } from "@/components/validation-content";
import { formatCurrency } from "@/lib/utils/format";
import { SimulationAssumptions } from "@/components/cards/mc-simulation-assumptions";
import { DecumulationConfig } from "./decumulation-config";
import { OverridesPanelV2 as OverridesPanel } from "./overrides-panel-v2";
import { ProjectionTable } from "./projection-table";
import { ProjectionHeroKpis } from "./projection-hero-kpis";
import { ProjectionChart, ProjectionChartSkeleton } from "./projection-chart";
import { McDepletionCallout, McResultsSection } from "./projection-mc-results";
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
    setProjectionMode,
    mcTrials,
    setMcTrials,
    mcPreset,
    setMcPreset,
    mcTaxMode,
    setMcTaxMode,
    mcAssetClassOverrides,
    setMcAssetClassOverrides,
    dollarMode,
    setDollarMode,
    balanceView,
    setBalanceView,
    contribView,
    setContribView,
    showAllYears,
    setShowAllYears,
    fanBandRange,
    setFanBandRange,
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
    mcLoading,
    mcBandsByYear,
    mcChartPending,
    result,
    enginePeople,
    engineSettings,
    getPersonYearTotals,
    personDepletionInfo,
    baseYear,
    deflate,
  } = s;

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
          {engineQuery.isLoading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <svg
                className="animate-spin h-6 w-6 text-blue-500"
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
              <div className="text-sm text-muted font-medium">
                Running projection engine...
              </div>
              {mcPrefetchQuery.isFetching && (
                <div className="text-[10px] text-purple-400">
                  + Monte Carlo background (1K trials)
                </div>
              )}
            </div>
          )}

          {engineQuery.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              Failed to run engine: {engineQuery.error.message}
            </div>
          )}

          {result && (
            <div className="space-y-4">
              {/* Hero KPIs */}
              <ProjectionHeroKpis s={s} />

              {/* MC depletion callout */}
              <McDepletionCallout s={s} />

              {/* Compact deterministic stats row */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg px-4 py-2.5 bg-surface-sunken text-xs">
                {mcQuery.data?.result && !mcLoading && (
                  <span className="text-[10px] font-medium text-faint uppercase tracking-wide mr-1">
                    Deterministic
                    <HelpTip text="Single-path projection using fixed average returns. Compare with Monte Carlo which simulates thousands of randomized return sequences." />
                  </span>
                )}
                {(() => {
                  const mcMedianPV =
                    mcPrefetchQuery.data?.result?.distributions
                      ?.sustainableWithdrawalPV?.median;
                  const hasMc = mcMedianPV != null && mcMedianPV > 0;
                  const currentAge = result.projectionByYear[0]?.age ?? 0;
                  const isRetired =
                    currentAge >= (engineSettings!.retirementAge ?? 999);
                  const detValue = deflate(
                    result.sustainableWithdrawal,
                    isRetired
                      ? baseYear
                      : baseYear + (engineSettings!.retirementAge - currentAge),
                  );
                  return (
                    <div>
                      <span className="text-muted">
                        {isPersonFiltered
                          ? `${personFilterName}'s Withdrawal`
                          : "Withdrawal"}
                        <HelpTip
                          text={
                            hasMc
                              ? "The median annual withdrawal across thousands of simulated market scenarios, in today's dollars. Half of simulations supported more than this amount, half supported less. Accounts for market volatility, tax impacts, and sequence-of-returns risk."
                              : engineSettings?.withdrawalStrategy &&
                                  engineSettings.withdrawalStrategy !== "fixed"
                                ? "Estimated first-year withdrawal based on your spending strategy. Actual withdrawals adjust yearly based on portfolio performance and strategy rules."
                                : "Estimated annual withdrawal calculated as your projected nest egg × withdrawal rate, assuming constant average returns. Does not account for market volatility or taxes."
                          }
                        />
                        :{" "}
                      </span>
                      <span className="font-semibold text-green-700">
                        {formatCurrency(hasMc ? mcMedianPV : detValue)}
                      </span>
                      <span className="text-faint">/yr</span>
                    </div>
                  );
                })()}
                <div className="w-px h-4 bg-surface-strong" />
                <div>
                  <span className="text-muted">Depletion: </span>
                  <span className="font-semibold">
                    {(() => {
                      const depl = isPersonFiltered
                        ? personDepletionInfo
                        : result.portfolioDepletionAge
                          ? { age: result.portfolioDepletionAge }
                          : null;
                      return depl ? `Age ${depl.age}` : "Never";
                    })()}
                  </span>
                </div>
                <div className="w-px h-4 bg-surface-strong" />
                <div>
                  <span className="text-muted">Overflow: </span>
                  <span className="font-semibold">
                    {result.firstOverflowAge
                      ? `Age ${result.firstOverflowAge}`
                      : "None"}
                  </span>
                  <HelpTip text="The first year your contributions exceed IRS limits for tax-advantaged accounts (401k, HSA, IRA). The excess spills into your taxable brokerage account." />
                </div>
                <div className="w-px h-4 bg-surface-strong" />
                <div>
                  <span className="text-muted">End Balance: </span>
                  <span className="font-semibold">
                    {(() => {
                      if (result.projectionByYear.length === 0) return "$0";
                      const last =
                        result.projectionByYear[
                          result.projectionByYear.length - 1
                        ]!;
                      const lastPt = getPersonYearTotals(last);
                      return formatCurrency(
                        deflate(
                          lastPt ? lastPt.balance : last.endBalance,
                          last.year,
                        ),
                      );
                    })()}
                  </span>
                  <span className="text-faint ml-1">
                    age{" "}
                    {result.projectionByYear.length > 0
                      ? result.projectionByYear[
                          result.projectionByYear.length - 1
                        ]!.age
                      : "?"}
                  </span>
                </div>
              </div>

              {/* Unified toolbar — two rows */}
              {(() => {
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
                                — Full historical returns, 0.9× vol, high equity
                                (95%→35%). Money Guy / Bogleheads &quot;age -
                                20&quot; bonds rule.
                              </span>,
                              <span key="def">
                                <strong className="text-green-300">
                                  Default
                                </strong>{" "}
                                — Historical returns, standard vol, hybrid FIRE
                                glide path (90%→50% floor). Vanguard TDF
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
                        <div className="inline-flex rounded-md border bg-surface-primary/60 p-0.5">
                          {pillBtn(
                            !isMc,
                            () => setProjectionMode("deterministic"),
                            "Deterministic",
                          )}
                          {pillBtn(
                            isMc,
                            () => setProjectionMode("monteCarlo"),
                            "Monte Carlo",
                          )}
                        </div>
                        {isMc && (
                          <>
                            <select
                              value={mcPreset}
                              onChange={(e) =>
                                setMcPreset(e.target.value as typeof mcPreset)
                              }
                              className="text-[10px] h-6 px-1.5 rounded border bg-surface-primary text-muted cursor-pointer"
                              title="MC preset scenario"
                            >
                              <option value="aggressive">Aggressive</option>
                              <option value="default">Default</option>
                              <option value="conservative">Conservative</option>
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
                                  — Full multi-account tax-aware simulation with
                                  gross-up and bracket filling.
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
                                  <span className="text-faint">(default)</span>
                                </div>
                                <div className="text-faint text-xs">
                                  Removes inflation — every dollar means the
                                  same as it does right now. A $100k balance in
                                  2050 shows what that money actually buys
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
                                <span className="text-green-300">Future $</span>{" "}
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
                    {/* Row 2: CONTRIBUTIONS | BALANCES | FAN BANDS | ALL YEARS */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-faint font-medium uppercase">
                          Contributions
                        </span>
                        <div className="inline-flex rounded-md border bg-surface-primary/60 p-0.5">
                          {pillBtn(
                            contribView === "account",
                            () => setContribView("account"),
                            "Account",
                          )}
                          {pillBtn(
                            contribView === "taxType",
                            () => setContribView("taxType"),
                            "Tax Type",
                          )}
                        </div>
                      </div>
                      <div className="w-px h-4 bg-surface-strong" />
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-faint font-medium uppercase">
                          Balances
                        </span>
                        <div className="inline-flex rounded-md border bg-surface-primary/60 p-0.5">
                          {pillBtn(
                            balanceView === "taxType",
                            () => setBalanceView("taxType"),
                            "Tax Type",
                          )}
                          {pillBtn(
                            balanceView === "account",
                            () => setBalanceView("account"),
                            "Account",
                          )}
                        </div>
                      </div>
                      {mcBandsByYear != null && (
                        <>
                          <div className="w-px h-4 bg-surface-strong" />
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-faint font-medium uppercase">
                              Fan Bands
                              <HelpTip
                                maxWidth={360}
                                lines={[
                                  "The shaded fan on the chart shows the spread of Monte Carlo outcomes across all simulated trials.",
                                  <span key="p25">
                                    <strong className="text-purple-300">
                                      p25-p75
                                    </strong>{" "}
                                    — Middle 50% of outcomes. Tightest view,
                                    shows the most likely range.
                                  </span>,
                                  <span key="p10">
                                    <strong className="text-purple-300">
                                      p10-p90
                                    </strong>{" "}
                                    — Middle 80% of outcomes. Wider view,
                                    includes moderately good and bad luck.
                                  </span>,
                                  <span key="p5">
                                    <strong className="text-purple-300">
                                      p5-p95
                                    </strong>{" "}
                                    — Middle 90% of outcomes. Widest view, can
                                    stretch the Y-axis significantly.
                                  </span>,
                                ]}
                              />
                            </span>
                            <div className="inline-flex rounded-md border bg-surface-primary/60 p-0.5">
                              {pillBtn(
                                fanBandRange === "p25-p75",
                                () => setFanBandRange("p25-p75"),
                                "p25–p75",
                              )}
                              {pillBtn(
                                fanBandRange === "p10-p90",
                                () => setFanBandRange("p10-p90"),
                                "p10–p90",
                              )}
                              {pillBtn(
                                fanBandRange === "p5-p95",
                                () => setFanBandRange("p5-p95"),
                                "p5–p95",
                              )}
                            </div>
                          </div>
                        </>
                      )}
                      <div className="w-px h-4 bg-surface-strong" />
                      <Toggle
                        label="All years"
                        checked={showAllYears}
                        onChange={setShowAllYears}
                        size="xs"
                      />
                    </div>
                  </div>
                );
              })()}

              {/* Visual Balance Projection — ComposedChart */}
              {mcChartPending && <ProjectionChartSkeleton />}
              {!mcChartPending && <ProjectionChart s={s} />}

              {/* Monte Carlo results */}
              <McResultsSection s={s} />
            </div>
          )}

          {/* UNIFIED TABLE */}
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
