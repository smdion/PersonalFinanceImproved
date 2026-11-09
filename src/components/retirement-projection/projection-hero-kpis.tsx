"use client";

/** Hero KPI cards — MC-adaptive 5-card grid. Unified card chrome across
 *  all metrics so the row reads as a single design language. Uses the same
 *  visual pattern as the MC summary bar in projection-mc-results.tsx. */
import { DEFAULT_SIMULATION } from "@/lib/constants";
import {
  baselineNestEgg,
  simulatedOrBaseline,
} from "@/lib/pure/retirement/nest-egg-display";
import { dominantFailureReason } from "@/lib/pure/retirement/plan-outcome";
import { assessPlan } from "@/lib/pure/retirement/plan-outcome";
import { rowTotal } from "./utils";
import { formatCurrency } from "@/lib/utils/format";
import type { ProjectionState } from "./projection-table-types";
import { KpiCard } from "./kpi-card";
import { CoastFireCard } from "@/components/retirement-projection/coast-fire-card";
import {
  WITHDRAWAL_STRATEGY_CONFIG,
  type WithdrawalStrategyType,
} from "@/lib/config/withdrawal-strategies";
import { SIMULATION_STRATEGY_STABILITY_GAP_ALERT_THRESHOLD } from "@/lib/constants";
import { simulationDollars } from "@/lib/pure/simulation/dollars";

// ---------------------------------------------------------------------------
// Compact ring — no colored background, just the ring + inline label
// ---------------------------------------------------------------------------

function CompactRing({ rate, size = 48 }: { rate: number; size?: number }) {
  const pct = Math.round(rate * 100);
  const ring =
    pct >= 90
      ? "stroke-green-500"
      : pct >= 75
        ? "stroke-yellow-500"
        : pct >= 50
          ? "stroke-orange-500"
          : "stroke-red-500";
  const textColor =
    pct >= 90
      ? "text-green-500"
      : pct >= 75
        ? "text-yellow-500"
        : pct >= 50
          ? "text-orange-500"
          : "text-red-500";
  const r = (size - 8) / 2;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - rate);
  const textSize = size >= 56 ? "text-sm" : "text-xs";

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        aria-hidden="true"
        className="-rotate-90"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth="4"
          className="stroke-surface-divider"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth="4"
          className={ring}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`${textSize} font-bold tabular-nums ${textColor}`}>
          {pct}%
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ProjectionHeroKpis({ state }: { state: ProjectionState }) {
  // Check via `state.result` before destructuring — result truthy always
  // implies engineSettings defined (see use-projection-derived.ts).
  if (!state.result) return null;

  const {
    result,
    engineSettings,
    isPersonFiltered,
    personFilterName,
    personDepletionInfo,
    getPersonYearTotals,
    deflate,
    mcQuery,
    simulationLoading,
    debouncedBaseInput,
    projectionView,
    coastFireMcQuery,
    activeAltMcResult,
    dollarMode,
    ageLabel,
    yearOfAge,
  } = state;

  const currentAge = result.projectionByYear[0]?.age ?? 0;
  const alreadyRetired = currentAge >= engineSettings.retirementAge;
  const retYear = alreadyRetired
    ? result.projectionByYear[0]
    : result.projectionByYear.find(
        (yearRow) => yearRow.age === engineSettings.retirementAge,
      );
  const retPt = retYear ? getPersonYearTotals(retYear) : null;
  // The household's figure is the engine's retirement money — the same one
  // the dashboard shows (baselineNestEgg); a person filter shows theirs.
  const household = baselineNestEgg(
    result.projectionByYear,
    alreadyRetired ? currentAge : engineSettings.retirementAge,
  );
  const nestEgg =
    retYear && retPt
      ? deflate(retPt.balance, retYear.year)
      : household
        ? deflate(household.nominal, household.year)
        : 0;
  const peakYear = result.projectionByYear.reduce((best, yearRow) => {
    const yearB = getPersonYearTotals(yearRow)?.balance ?? rowTotal(yearRow);
    const bestB = getPersonYearTotals(best)?.balance ?? rowTotal(best);
    return deflate(yearB, yearRow.year) > deflate(bestB, best.year)
      ? yearRow
      : best;
  });
  const peakPt = getPersonYearTotals(peakYear);
  const peakBalance = deflate(
    peakPt ? peakPt.balance : rowTotal(peakYear),
    peakYear.year,
  );
  // Coast FIRE / Rate-Seeded views swap all hero KPIs to that scenario's MC,
  // the same `activeAltMcResult` the query/derived hooks use. Null while it
  // loads; the `!simulation && simulationLoading` skeleton covers that.
  const simulation =
    projectionView === "coastFire" ||
    projectionView === "coastFireToday" ||
    projectionView === "rateSeeded"
      ? (activeAltMcResult ?? null)
      : mcQuery.data?.result && !simulationLoading
        ? mcQuery.data.result
        : null;
  // In the shown dollars — today's from the Simulation's per-trial deflation.
  const simulationBands = simulation
    ? simulationDollars(simulation, dollarMode).percentileBands
    : null;
  // One rule for simulated vs baseline (nest-egg-display.ts, shared with
  // the dashboard): a person filter shows the baseline — the simulation is
  // the whole household's.
  const nestEggDisplay = simulatedOrBaseline({
    bands: simulationBands,
    baseline: nestEgg,
    targetAge: alreadyRetired ? currentAge : engineSettings.retirementAge,
    personFiltered: isPersonFiltered,
  });
  // A non-default simulation preset is named next to the range.
  const simInputs =
    mcQuery.data && "simulationInputs" in mcQuery.data
      ? mcQuery.data.simulationInputs
      : undefined;
  const presetNote =
    simInputs && simInputs.preset !== DEFAULT_SIMULATION.preset
      ? ` · ${simInputs.presetLabel} preset`
      : "";
  const lastYear = result.projectionByYear.at(-1);
  const lastPt = lastYear ? getPersonYearTotals(lastYear) : null;
  const endDisplay = simulatedOrBaseline({
    bands: simulationBands,
    baseline: lastYear
      ? deflate(lastPt ? lastPt.balance : rowTotal(lastYear), lastYear.year)
      : 0,
    // The last projected year, which the engine labels endAge − 1 (its
    // balance is the end-of-year figure the card reads as "at endAge") —
    // the same row the baseline came from.
    targetAge: lastYear?.age ?? 0,
    personFiltered: isPersonFiltered,
  });
  // The plan judge: retirement money runs out, or a year falls short.
  const outcome = assessPlan(result);
  const depl = isPersonFiltered
    ? personDepletionInfo
    : !outcome.succeeded
      ? {
          age: outcome.failureAge,
          year: outcome.failureYear,
          reason: outcome.failureReason,
        }
      : null;

  // MC loading — show skeleton instead of flashing deterministic cards
  if (!simulation && simulationLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="border-subtle bg-surface-primary/40 min-h-[128px] animate-pulse rounded-lg border p-3"
          >
            <div className="bg-surface-strong/20 h-2.5 w-20 rounded" />
            <div className="bg-surface-strong/20 mt-4 h-8 w-24 rounded" />
            <div className="bg-surface-strong/20 mt-2 h-2 w-16 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (simulation) {
    // MC-primary hero
    const hasBudgetStability = simulation.budgetStabilityRate !== null;
    const retSpan = engineSettings.endAge - engineSettings.retirementAge;

    // Long-horizon tip names the strategy's real knob: the withdrawal rate
    // for budget-continuation strategies, none for RMD-Based (IRS formula),
    // Strategy Params for Constant %/Endowment/Vanguard Dynamic.
    const activeStrategy =
      engineSettings.withdrawalStrategy as WithdrawalStrategyType;
    const strategyMeta = WITHDRAWAL_STRATEGY_CONFIG[activeStrategy];
    const longHorizonTip =
      strategyMeta.incomeSource === "formula"
        ? `Your projection spans ${retSpan} years — longer than the classic 30-year 4% rule. ${strategyMeta.label} has no user-set rate to lower; consider a lower ${strategyMeta.paramFields.find((f) => typeof f.default === "number")?.label ?? "Strategy Params setting"} in Strategy Params if you want to slow spending.`
        : strategyMeta.usesWithdrawalRate
          ? `Your projection spans ${retSpan} years — longer than the classic 30-year 4% rule. Early retirees often need a lower withdrawal rate — for ${strategyMeta.label}, that means a smaller Retirement Budget, not this Initial Withdrawal Rate field.`
          : `Your projection spans ${retSpan} years — longer than the classic 30-year 4% rule. For ${strategyMeta.label}, the knob to lower is ${strategyMeta.paramFields.find((f) => typeof f.default === "number")?.label ?? "your Strategy Params rate"}, not this Initial Withdrawal Rate field.`;

    // "vs strategy" trailing Portfolio Survival by a real margin means the
    // plan deviates from the strategy even though the money survives. Both
    // figures come from the same Simulation run.
    const strategyGapUrgent =
      simulation.successRate - simulation.spendingStabilityRate >
      SIMULATION_STRATEGY_STABILITY_GAP_ALERT_THRESHOLD;
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {/* Card 1: Portfolio Survival */}
        <KpiCard
          label="Portfolio Survival"
          tooltip={[
            `Percentage of simulated futures where every retirement year is funded — money doesn't run out or fall short — through age ${engineSettings.endAge} — a ${retSpan}-year retirement. This is the industry-standard metric (Trinity Study, cFIREsim).`,
            "90%+ — Strong. Most planners consider this the target.",
            "75–89% — Moderate. Workable but with meaningful risk.",
            "Below 75% — Elevated risk. Review your assumptions.",
            ...(retSpan > 30 ? [longHorizonTip] : []),
            "For dynamic strategies that reduce spending, see Yearly Income Stability for the full picture.",
            ...(isPersonFiltered
              ? [
                  `Always reflects the WHOLE household, not just ${personFilterName} — a simulated trial's survival depends on your shared withdrawal strategy and combined spending, not one person's accounts alone.`,
                ]
              : []),
          ]}
        >
          <div className="flex flex-1 flex-col items-center justify-center gap-1">
            <CompactRing rate={simulation.successRate} size={68} />
            <div className="text-micro text-faint">
              {simulation.distributions.failureAge
                ? `${dominantFailureReason(simulation.failureReasonRates) === "depleted" ? "runs out" : "falls short"} ~${yearOfAge(Math.round(simulation.distributions.failureAge.median))}`
                : `through ${lastYear?.year ?? "?"}`}
            </div>
          </div>
        </KpiCard>

        {/* Card 2: Lifetime Income Stability */}
        <KpiCard
          label="Lifetime Income Stability"
          tooltip={[
            '% of simulated futures where income NEVER dropped below the 75% floor, in ANY year, across your entire retirement — a much stricter bar than "how does a typical year look," since it only takes one bad year, in one simulated future, to fail. See the Yearly Income Stability chart for the year-by-year detail behind this number.',
            '"vs Strategy": compares against the strategy\'s own target for each year. Measures self-consistency.',
            '"vs Budget": compares against your stated retirement budget. Measures whether your actual needs are met.',
            "Fixed and Forgo track your Retirement budget, so the rings stay close; Guardrails and Spending Decline move away from it by design. Balance-based strategies (RMD-Based, Constant %, Endowment, Vanguard, VPW) follow the balance; the gap shows how often they cover your Retirement budget.",
            ...(strategyGapUrgent
              ? [
                  `⚠ Your money survives in ${(simulation.successRate * 100).toFixed(0)} out of 100 simulated futures, but only ${(simulation.spendingStabilityRate * 100).toFixed(0)} out of 100 stick to your strategy's own year-by-year target the whole way through. In the other ${((simulation.successRate - simulation.spendingStabilityRate) * 100).toFixed(0)}, something forces at least one year's withdrawal off target — most likely a Required Minimum Distribution (RMD) later in retirement, pulling out more than the strategy itself wanted. Open the Yearly Income Stability chart to see which years.`,
                ]
              : []),
          ]}
        >
          <div className="flex flex-1 items-center justify-center gap-4">
            <div className="flex flex-col items-center gap-1">
              <CompactRing rate={simulation.spendingStabilityRate} size={56} />
              <div
                className={`text-micro flex items-center gap-0.5 ${strategyGapUrgent ? "font-medium text-red-500" : "text-faint"}`}
              >
                {strategyGapUrgent && <span>⚠</span>}
                vs strategy
              </div>
            </div>
            <div className="flex flex-col items-center gap-1">
              <CompactRing
                rate={
                  hasBudgetStability
                    ? simulation.budgetStabilityRate!
                    : simulation.spendingStabilityRate
                }
                size={56}
              />
              <div className="text-micro text-faint">vs budget</div>
            </div>
          </div>
        </KpiCard>

        {/* Card 3: Nest Egg at Retirement */}
        <KpiCard
          label={
            isPersonFiltered
              ? `${personFilterName}'s Nest Egg`
              : alreadyRetired
                ? "Current Portfolio"
                : "Nest Egg at Retirement"
          }
        >
          <div className="text-primary text-xl font-bold tabular-nums">
            {formatCurrency(
              nestEggDisplay.kind === "simulated"
                ? nestEggDisplay.median
                : nestEggDisplay.baseline,
            )}
          </div>
          {nestEggDisplay.kind === "simulated" ? (
            <>
              <div className="text-caption text-faint mt-1 leading-tight">
                Range {formatCurrency(nestEggDisplay.low)} –{" "}
                {formatCurrency(nestEggDisplay.high)}
                {presetNote}
              </div>
              <div className="text-caption text-faint leading-tight">
                Baseline: {formatCurrency(nestEggDisplay.baseline)} (fixed
                returns)
              </div>
            </>
          ) : (
            <div className="text-caption text-faint mt-1 leading-tight">
              Baseline (fixed returns)
              {isPersonFiltered ? " — the simulation is household-wide" : ""}
            </div>
          )}
        </KpiCard>

        {/* Card 4: End Balance */}
        <KpiCard label="End Balance">
          <div className="text-primary text-xl font-bold tabular-nums">
            {formatCurrency(
              endDisplay.kind === "simulated"
                ? endDisplay.median
                : endDisplay.baseline,
            )}
          </div>
          {endDisplay.kind === "simulated" ? (
            <>
              <div className="text-caption text-faint mt-1 leading-tight">
                Range {formatCurrency(endDisplay.low)} –{" "}
                {formatCurrency(endDisplay.high)} in {lastYear?.year ?? "?"}
              </div>
              <div className="text-caption text-faint leading-tight">
                Baseline: {formatCurrency(endDisplay.baseline)} (fixed returns)
              </div>
            </>
          ) : (
            <div className="text-caption text-faint mt-1 leading-tight">
              Baseline (fixed returns) in {lastYear?.year ?? "?"}
              {isPersonFiltered ? " — the simulation is household-wide" : ""}
            </div>
          )}
        </KpiCard>

        {/* Card 5: Coast FIRE */}
        <CoastFireCard
          input={debouncedBaseInput}
          coastFireMcResult={coastFireMcQuery.data?.result ?? undefined}
          coastFireSimulationLoading={
            coastFireMcQuery.isLoading || coastFireMcQuery.isFetching
          }
          coastFireSimulationComputedAt={coastFireMcQuery.data?.computedAt}
          coastFireSimulationNotConfigured={
            coastFireMcQuery.data && "notConfigured" in coastFireMcQuery.data
              ? coastFireMcQuery.data.notConfigured
              : null
          }
          ageLabel={ageLabel}
        />
      </div>
    );
  }

  // Deterministic hero (no MC) — 4 cards including Coast FIRE
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <KpiCard
        label={
          isPersonFiltered
            ? `${personFilterName}'s Nest Egg`
            : alreadyRetired
              ? "Current Portfolio"
              : "Nest Egg at Retirement"
        }
      >
        <div className="text-primary text-xl font-bold tabular-nums">
          {formatCurrency(nestEgg)}
        </div>
        <div className="text-caption text-faint mt-1">
          {alreadyRetired
            ? `${result.projectionByYear[0]?.year} (today's $)`
            : `In ${yearOfAge(engineSettings.retirementAge)}`}
        </div>
      </KpiCard>

      <KpiCard
        label={isPersonFiltered ? `${personFilterName}'s Peak` : "Peak Balance"}
      >
        <div className="text-primary text-xl font-bold tabular-nums">
          {formatCurrency(peakBalance)}
        </div>
        <div className="text-caption text-faint mt-1">
          Maximum projected balance
        </div>
      </KpiCard>

      <KpiCard
        label={
          isPersonFiltered
            ? `${personFilterName}'s Funding`
            : "Funding Duration"
        }
      >
        <div
          className={`text-xl font-bold tabular-nums ${depl ? "text-red-500" : "text-green-500"}`}
        >
          {depl ? String(depl.year) : "Lasts ✓"}
        </div>
        <div className="text-caption text-faint mt-1">
          {depl
            ? `${"reason" in depl && depl.reason !== "depleted" ? "Falls short" : "Runs out"} then`
            : `Through ${lastYear?.year ?? "?"}`}
        </div>
      </KpiCard>

      {/* Coast FIRE — 4th card in deterministic mode */}
      <CoastFireCard
        input={debouncedBaseInput}
        coastFireMcResult={undefined}
        coastFireSimulationLoading={false}
        ageLabel={ageLabel}
      />
    </div>
  );
}
