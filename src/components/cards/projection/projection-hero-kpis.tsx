"use client";

/** Hero KPI cards — MC-adaptive 5-card grid. Unified card chrome across
 *  all metrics so the row reads as a single design language. Uses the same
 *  visual pattern as the MC summary bar in projection-mc-results.tsx. */
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency } from "@/lib/utils/format";
import type { ProjectionState } from "./projection-table-types";
import { CoastFireCard } from "@/components/cards/coast-fire-card";
import {
  WITHDRAWAL_STRATEGY_CONFIG,
  type WithdrawalStrategyType,
} from "@/lib/config/withdrawal-strategies";
import { MC_STRATEGY_STABILITY_GAP_ALERT_THRESHOLD } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Unified card chrome — matches projection-mc-results.tsx summary bar
// ---------------------------------------------------------------------------

export function KpiCard({
  label,
  tooltip,
  children,
  className = "",
}: {
  label: string;
  tooltip?: (string | React.ReactNode)[];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-subtle bg-surface-primary/40 px-3 py-2.5 flex flex-col ${className}`}
    >
      <div className="text-caption font-semibold uppercase tracking-wider text-faint flex items-center gap-1">
        {label}
        {tooltip && <HelpTip maxWidth={420} lines={tooltip} />}
      </div>
      <div className="flex-1 flex flex-col mt-2">{children}</div>
    </div>
  );
}

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
    baseYear,
    mcQuery,
    mcLoading,
    debouncedBaseInput,
    scenarioView,
    coastFireMcQuery,
    activeAltMcResult,
  } = state;

  const currentAge = result.projectionByYear[0]?.age ?? 0;
  const alreadyRetired = currentAge >= (engineSettings?.retirementAge ?? 999);
  const retYear = alreadyRetired
    ? result.projectionByYear[0]
    : result.projectionByYear.find(
        (yr) => yr.age === engineSettings?.retirementAge,
      );
  const retPt = retYear ? getPersonYearTotals(retYear) : null;
  const nestEgg = retYear
    ? deflate(retPt ? retPt.balance : retYear.endBalance, retYear.year)
    : 0;
  const peakYear = result.projectionByYear.reduce((best, yr) => {
    const yrB = getPersonYearTotals(yr)?.balance ?? yr.endBalance;
    const bestB = getPersonYearTotals(best)?.balance ?? best.endBalance;
    return deflate(yrB, yr.year) > deflate(bestB, best.year) ? yr : best;
  });
  const peakPt = getPersonYearTotals(peakYear);
  const peakBalance = deflate(
    peakPt ? peakPt.balance : peakYear.endBalance,
    peakYear.year,
  );
  // When scenarioView is a Coast FIRE variant OR Rate-Seeded, swap the MC
  // data source so all the hero KPIs — Portfolio Survival, Lifetime Income
  // Stability, Nest Egg, End Balance — reflect that scenario, not the
  // baseline plan. Reads the SAME `activeAltMcResult` use-projection-
  // queries.ts and use-projection-derived.ts consume — previously hand-
  // derived a third time here with its own copy of the scenarioView
  // ternary, which risked silently disagreeing with the other two on a
  // future scenarioView change (code review, 2026-08-27). Intentionally
  // null while the alt-scenario MC is loading — the existing
  // `!mc && mcLoading` skeleton branch below handles the loading state.
  const mc =
    scenarioView === "coastFire" ||
    scenarioView === "coastFireToday" ||
    scenarioView === "rateSeeded"
      ? (activeAltMcResult ?? null)
      : mcQuery.data?.result && !mcLoading
        ? mcQuery.data.result
        : null;
  const mcBands = mc?.percentileBands ?? null;
  const mcRetBand = mcBands?.find((b) =>
    alreadyRetired
      ? b.age === currentAge
      : b.age === engineSettings?.retirementAge,
  );
  const terminalYear =
    baseYear + (engineSettings.endAge - (result.projectionByYear[0]?.age ?? 0));
  const depl = isPersonFiltered
    ? personDepletionInfo
    : result.portfolioDepletionAge
      ? {
          age: result.portfolioDepletionAge,
          year: result.portfolioDepletionYear,
        }
      : null;

  // MC loading — show skeleton instead of flashing deterministic cards
  if (!mc && mcLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-lg border border-subtle bg-surface-primary/40 p-3 min-h-[128px] animate-pulse"
          >
            <div className="h-2.5 w-20 bg-surface-strong/20 rounded" />
            <div className="h-8 w-24 bg-surface-strong/20 rounded mt-4" />
            <div className="h-2 w-16 bg-surface-strong/20 rounded mt-2" />
          </div>
        ))}
      </div>
    );
  }

  if (mc) {
    // MC-primary hero
    const hasBudgetStability = mc.budgetStabilityRate !== null;
    const retSpan =
      (engineSettings?.endAge ?? 95) - (engineSettings?.retirementAge ?? 65);

    // R45 Step 3, Finding 5: the long-horizon tip used to blanket-suggest
    // "a lower withdrawal rate (3-3.5%)" — accurate advice for the budget-
    // continuation strategies, but there's no user-set rate to lower for
    // RMD-Based Spending (IRS-formula-driven), and the real knob for
    // Constant %/Endowment/Vanguard Dynamic is their own Strategy Params
    // field, not the Initial Withdrawal Rate this tooltip sits near.
    const activeStrategy = (engineSettings?.withdrawalStrategy ??
      "fixed") as WithdrawalStrategyType;
    const strategyMeta = WITHDRAWAL_STRATEGY_CONFIG[activeStrategy];
    const longHorizonTip =
      strategyMeta.incomeSource === "formula"
        ? `Your plan spans ${retSpan} years — longer than the classic 30-year 4% rule. ${strategyMeta.label} has no user-set rate to lower; consider a lower RMD Multiplier in Strategy Params if you want to slow spending.`
        : strategyMeta.usesWithdrawalRate
          ? `Your plan spans ${retSpan} years — longer than the classic 30-year 4% rule. Early retirees often need a lower withdrawal rate — for ${strategyMeta.label}, that means a smaller Retirement Budget, not this Initial Withdrawal Rate field.`
          : `Your plan spans ${retSpan} years — longer than the classic 30-year 4% rule. For ${strategyMeta.label}, the knob to lower is ${strategyMeta.paramFields.find((f) => typeof f.default === "number")?.label ?? "your Strategy Params rate"}, not this Initial Withdrawal Rate field.`;

    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {/* Card 1: Portfolio Survival */}
        <KpiCard
          label="Portfolio Survival"
          tooltip={[
            `Percentage of simulated futures where your portfolio balance stays above $0 through age ${engineSettings?.endAge ?? "?"} — a ${retSpan}-year retirement. This is the industry-standard metric (Trinity Study, cFIREsim).`,
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
          <div className="flex flex-col items-center justify-center flex-1 gap-1">
            <CompactRing rate={mc.successRate} size={68} />
            <div className="text-micro text-faint">
              {mc.distributions.depletionAge
                ? `depletes ~age ${Math.round(mc.distributions.depletionAge.median)}`
                : `vs age ${engineSettings?.endAge ?? "?"}`}
            </div>
          </div>
        </KpiCard>

        {/* Card 2: Lifetime Income Stability */}
        {(() => {
          // Advisor review, 2026-08-28: when "vs strategy" trails Portfolio
          // Survival by a real margin, something is forcing deviations
          // from the strategy's own plan even though the money survives —
          // worth flagging urgently. This is an MC-vs-MC comparison (both
          // numbers come from the same run), unlike a deterministic
          // unmet-need alert, which gets its own separate affordance
          // rather than being grafted onto this MC statistic.
          const strategyGapUrgent =
            mc.successRate - mc.spendingStabilityRate >
            MC_STRATEGY_STABILITY_GAP_ALERT_THRESHOLD;
          return (
            <KpiCard
              label="Lifetime Income Stability"
              tooltip={[
                '% of simulated futures where income NEVER dropped below the 75% floor, in ANY year, across your entire retirement — a much stricter bar than "how does a typical year look," since it only takes one bad year, in one simulated future, to fail. See the Yearly Income Stability chart for the year-by-year detail behind this number.',
                '"vs Strategy": compares against the strategy\'s own target for each year. Measures self-consistency.',
                '"vs Budget": compares against your stated retirement budget. Measures whether your actual needs are met.',
                "For budget-based strategies (Fixed, Forgo, G-K), both donuts converge — spending IS the budget. For portfolio-linked strategies (Const %, Vanguard), the gap tells the story.",
                ...(strategyGapUrgent
                  ? [
                      `⚠ Your money survives in ${(mc.successRate * 100).toFixed(0)} out of 100 simulated futures, but only ${(mc.spendingStabilityRate * 100).toFixed(0)} out of 100 stick to your strategy's own year-by-year plan the whole way through. In the other ${((mc.successRate - mc.spendingStabilityRate) * 100).toFixed(0)}, something forces at least one year's withdrawal off-plan — most likely a Required Minimum Distribution (RMD) later in retirement, pulling out more than the strategy itself wanted. Open the Yearly Income Stability chart to see which years.`,
                    ]
                  : []),
              ]}
            >
              <div className="flex items-center gap-4 justify-center flex-1">
                <div className="flex flex-col items-center gap-1">
                  <CompactRing rate={mc.spendingStabilityRate} size={56} />
                  <div
                    className={`text-micro flex items-center gap-0.5 ${strategyGapUrgent ? "text-red-500 font-medium" : "text-faint"}`}
                  >
                    {strategyGapUrgent && <span>⚠</span>}
                    vs strategy
                  </div>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <CompactRing
                    rate={
                      hasBudgetStability
                        ? mc.budgetStabilityRate!
                        : mc.spendingStabilityRate
                    }
                    size={56}
                  />
                  <div className="text-micro text-faint">vs budget</div>
                </div>
              </div>
            </KpiCard>
          );
        })()}

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
          <div className="text-xl font-bold tabular-nums text-primary">
            {mcRetBand
              ? formatCurrency(deflate(mcRetBand.p50, mcRetBand.year))
              : formatCurrency(nestEgg)}
          </div>
          {mcRetBand && (
            <div className="text-caption text-faint mt-1 leading-tight">
              Range {formatCurrency(deflate(mcRetBand.p25, mcRetBand.year))} –{" "}
              {formatCurrency(deflate(mcRetBand.p75, mcRetBand.year))}
            </div>
          )}
          <div className="text-caption text-faint leading-tight">
            Baseline: {formatCurrency(nestEgg)}
          </div>
        </KpiCard>

        {/* Card 4: End Balance */}
        <KpiCard label="End Balance">
          <div className="text-xl font-bold tabular-nums text-primary">
            {formatCurrency(deflate(mc.medianEndBalance, terminalYear))}
          </div>
          <div className="text-caption text-faint mt-1 leading-tight">
            Sim. median at age {engineSettings?.endAge ?? "?"}
          </div>
          <div className="text-caption text-faint leading-tight">
            {(() => {
              if (!result || result.projectionByYear.length === 0)
                return "Baseline: $0";
              const last =
                result.projectionByYear[result.projectionByYear.length - 1]!;
              const lastPt = getPersonYearTotals(last);
              const detEndBalance = deflate(
                lastPt ? lastPt.balance : last.endBalance,
                last.year,
              );
              return `Baseline: ${formatCurrency(detEndBalance)}`;
            })()}
          </div>
        </KpiCard>

        {/* Card 5: Coast FIRE */}
        <CoastFireCard
          input={debouncedBaseInput}
          coastFireMcResult={coastFireMcQuery.data?.result ?? undefined}
          coastFireMcLoading={
            coastFireMcQuery.isLoading || coastFireMcQuery.isFetching
          }
          coastFireMcComputedAt={coastFireMcQuery.data?.computedAt}
        />
      </div>
    );
  }

  // Deterministic hero (no MC) — 4 cards including Coast FIRE
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <KpiCard
        label={
          isPersonFiltered
            ? `${personFilterName}'s Nest Egg`
            : alreadyRetired
              ? "Current Portfolio"
              : "Nest Egg at Retirement"
        }
      >
        <div className="text-xl font-bold tabular-nums text-primary">
          {formatCurrency(nestEgg)}
        </div>
        <div className="text-caption text-faint mt-1">
          {alreadyRetired
            ? `Age ${currentAge} (today's $)`
            : `Avg age ${engineSettings?.retirementAge ?? "?"}`}
        </div>
      </KpiCard>

      <KpiCard
        label={isPersonFiltered ? `${personFilterName}'s Peak` : "Peak Balance"}
      >
        <div className="text-xl font-bold tabular-nums text-primary">
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
          {depl ? `Age ${depl.age}` : "Lasts ✓"}
        </div>
        <div className="text-caption text-faint mt-1">
          {depl
            ? `Runs out ${depl.year}`
            : `Through age ${engineSettings?.endAge ?? "?"}`}
        </div>
      </KpiCard>

      {/* Coast FIRE — 4th card in deterministic mode */}
      <CoastFireCard
        input={debouncedBaseInput}
        coastFireMcResult={undefined}
        coastFireMcLoading={false}
      />
    </div>
  );
}
