"use client";

/** Hero KPI cards — MC-adaptive 5-card grid. Unified card chrome across
 *  all metrics so the row reads as a single design language. Uses the same
 *  visual pattern as the MC summary bar in projection-mc-results.tsx. */
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency } from "@/lib/utils/format";
import type { useProjectionState } from "./use-projection-state";
import { CoastFireCard } from "@/components/cards/coast-fire-card";

type ProjectionState = ReturnType<typeof useProjectionState>;

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
      <div className="text-[10px] font-semibold uppercase tracking-wider text-faint flex items-center gap-1">
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

export function ProjectionHeroKpis({ s }: { s: ProjectionState }) {
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
    coastFireMcResult,
  } = s;

  if (!result) return null;

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
  // When scenarioView === "coastFire", swap the MC data source to the
  // Coast FIRE MC result (from computeCoastFireMC's final probe) so all the
  // hero KPIs — Portfolio Survival, Income Stability, Nest Egg, End Balance —
  // reflect the Coast FIRE scenario, not the baseline plan. Intentionally
  // returns null while coast MC is loading — the existing `!mc && mcLoading`
  // skeleton branch below handles the loading state.
  const mc =
    scenarioView === "coastFire"
      ? (coastFireMcResult ?? null)
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
    baseYear +
    (engineSettings!.endAge - (result.projectionByYear[0]?.age ?? 0));
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
            ...(retSpan > 30
              ? [
                  "Your plan spans 40 years — longer than the classic 30-year 4% rule. Early retirees often need a lower withdrawal rate (3-3.5%).",
                ]
              : []),
            "For dynamic strategies that reduce spending, see Spending Stability for the full picture.",
          ]}
        >
          <div className="flex flex-col items-center justify-center flex-1 gap-1">
            <CompactRing rate={mc.successRate} size={68} />
            <div className="text-[9px] text-faint">
              {mc.distributions.depletionAge
                ? `depletes ~age ${Math.round(mc.distributions.depletionAge.median)}`
                : `vs age ${engineSettings?.endAge ?? "?"}`}
            </div>
          </div>
        </KpiCard>

        {/* Card 2: Income Stability */}
        <KpiCard
          label="Income Stability"
          tooltip={[
            "Two views of spending stability — how often your income holds up across simulated futures.",
            '"vs Strategy": compares against the strategy\'s own year-1 withdrawal. Measures self-consistency.',
            '"vs Budget": compares against your stated retirement budget. Measures whether your actual needs are met.',
            "For budget-based strategies (Fixed, Forgo, G-K), both donuts converge — spending IS the budget. For portfolio-linked strategies (Const %, Vanguard), the gap tells the story.",
          ]}
        >
          <div className="flex items-center gap-4 justify-center flex-1">
            <div className="flex flex-col items-center gap-1">
              <CompactRing rate={mc.spendingStabilityRate} size={56} />
              <div className="text-[9px] text-faint">vs strategy</div>
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
              <div className="text-[9px] text-faint">vs budget</div>
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
          <div className="text-xl font-bold tabular-nums text-primary">
            {mcRetBand
              ? formatCurrency(deflate(mcRetBand.p50, mcRetBand.year))
              : formatCurrency(nestEgg)}
          </div>
          {mcRetBand && (
            <div className="text-[10px] text-faint mt-1 leading-tight">
              Range {formatCurrency(deflate(mcRetBand.p25, mcRetBand.year))} –{" "}
              {formatCurrency(deflate(mcRetBand.p75, mcRetBand.year))}
            </div>
          )}
          <div className="text-[10px] text-faint leading-tight">
            Baseline: {formatCurrency(nestEgg)}
          </div>
        </KpiCard>

        {/* Card 4: End Balance */}
        <KpiCard label="End Balance">
          <div className="text-xl font-bold tabular-nums text-primary">
            {formatCurrency(deflate(mc.medianEndBalance, terminalYear))}
          </div>
          <div className="text-[10px] text-faint mt-1 leading-tight">
            Sim. median at age {engineSettings?.endAge ?? "?"}
          </div>
          <div className="text-[10px] text-faint leading-tight">
            {(() => {
              if (!result || result.projectionByYear.length === 0)
                return "Baseline: $0";
              const last =
                result.projectionByYear[result.projectionByYear.length - 1]!;
              return `Baseline: ${formatCurrency(deflate(last.endBalance, last.year))}`;
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
        <div className="text-[10px] text-faint mt-1">
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
        <div className="text-[10px] text-faint mt-1">
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
        <div className="text-[10px] text-faint mt-1">
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
