"use client";

/** Hero KPI cards — MC-adaptive (success rate gauge, nest egg, funding outlook) or deterministic (nest egg, peak, duration). */
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency } from "@/lib/utils/format";
import type { useProjectionState } from "./use-projection-state";

type ProjectionState = ReturnType<typeof useProjectionState>;

// ---------------------------------------------------------------------------
// Reusable gauge donut — data-driven, no per-metric knowledge
// ---------------------------------------------------------------------------

function GaugeDonut({
  rate,
  label,
  subtitle,
  tooltip,
  size = "normal",
}: {
  rate: number;
  label: string;
  subtitle?: string;
  tooltip?: (string | React.ReactNode)[];
  size?: "normal" | "small";
}) {
  const pct = Math.round(rate * 100);
  const textColor =
    pct >= 90
      ? "text-green-600"
      : pct >= 75
        ? "text-yellow-600"
        : pct >= 50
          ? "text-orange-500"
          : "text-red-600";
  const bg =
    pct >= 90
      ? "bg-green-50"
      : pct >= 75
        ? "bg-yellow-50"
        : pct >= 50
          ? "bg-orange-50"
          : "bg-red-50";
  const ring =
    pct >= 90
      ? "stroke-green-500"
      : pct >= 75
        ? "stroke-yellow-500"
        : pct >= 50
          ? "stroke-orange-500"
          : "stroke-red-500";
  const r = 40;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - rate);
  const svgSize = size === "small" ? "w-14 h-14" : "w-20 h-20";
  const textSize = size === "small" ? "text-base" : "text-xl";

  return (
    <div
      className={`${bg} rounded-lg p-3 flex flex-col items-center justify-center`}
    >
      <div className={`relative ${svgSize}`}>
        <svg
          aria-hidden="true"
          className={`${svgSize} -rotate-90`}
          viewBox="0 0 100 100"
        >
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            strokeWidth="8"
            className="stroke-gray-200"
          />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            strokeWidth="8"
            className={ring}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`${textSize} font-bold ${textColor}`}>{pct}%</span>
        </div>
      </div>
      <div className="text-xs text-muted mt-1 text-center">
        {label}
        {tooltip && <HelpTip maxWidth={420} lines={tooltip} />}
      </div>
      {subtitle && (
        <div className="text-[10px] text-faint mt-0.5">{subtitle}</div>
      )}
    </div>
  );
}

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
  const mc = mcQuery.data?.result && !mcLoading ? mcQuery.data.result : null;
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
      <div className="grid grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-surface-sunken rounded-lg p-4 flex flex-col items-center justify-center animate-pulse"
          >
            <div className="w-20 h-20 rounded-full bg-gray-200/20" />
            <div className="h-3 w-20 bg-gray-200/20 rounded mt-2" />
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
      <div className="grid grid-cols-4 gap-4">
        {/* Card 1: Success Rate */}
        <GaugeDonut
          rate={mc.successRate}
          label="Success Rate"
          subtitle={
            mc.distributions.depletionAge
              ? `Depletes ~age ${Math.round(mc.distributions.depletionAge.median)}`
              : "Baseline: Lasts \u2713"
          }
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
        />

        {/* Card 2: Spending Stability — two mini donuts side by side */}
        <div className="bg-surface-primary rounded-lg p-3 flex flex-col items-center justify-center">
          <div className="flex gap-2">
            <GaugeDonut
              rate={mc.spendingStabilityRate}
              label="vs Strategy"
              size="small"
              tooltip={[
                "Percentage of futures where withdrawals stayed at or above 75% of the strategy's initial year-1 withdrawal, adjusted for inflation.",
                "Measures whether the strategy maintains its own planned income level. For portfolio-linked strategies (Const %, Endowment, Vanguard), this is naturally low because spending tracks portfolio volatility.",
              ]}
            />
            {hasBudgetStability ? (
              <GaugeDonut
                rate={mc.budgetStabilityRate!}
                label="vs Budget"
                size="small"
                tooltip={[
                  "Percentage of futures where withdrawals stayed at or above 75% of your stated retirement budget, adjusted for inflation.",
                  'Measures whether the strategy covers what you actually need. For strategies that withdraw more than your budget, this will be higher than "vs Strategy" — meaning your needs are met even when the strategy\'s own spending dips.',
                ]}
              />
            ) : (
              <GaugeDonut
                rate={mc.spendingStabilityRate}
                label="vs Budget"
                size="small"
                tooltip={[
                  'No separate retirement budget set — using strategy year-1 withdrawal as the baseline (same as "vs Strategy").',
                  "Set a retirement budget in Decumulation Plan to see how often the strategy covers your actual needs.",
                ]}
              />
            )}
          </div>
          <div className="text-xs text-muted mt-1 text-center">
            Spending Stability
            <HelpTip
              maxWidth={420}
              lines={[
                "Two views of spending stability — how often your income holds up across simulated futures.",
                '"vs Strategy": compares against the strategy\'s own year-1 withdrawal. Measures self-consistency.',
                '"vs Budget": compares against your stated retirement budget. Measures whether your actual needs are met.',
                "For budget-based strategies (Fixed, Forgo, G-K), both donuts converge — spending IS the budget. For portfolio-linked strategies (Const %, Vanguard), the gap tells the story.",
              ]}
            />
          </div>
        </div>

        {/* Card 2: Nest Egg (MC primary) */}
        <div className="bg-purple-50 rounded-lg p-4 text-center">
          <div className="text-xs text-purple-600 uppercase font-medium">
            {isPersonFiltered
              ? `${personFilterName}'s Nest Egg`
              : alreadyRetired
                ? "Current Portfolio"
                : "Nest Egg at Retirement"}
          </div>
          <div className="text-2xl font-bold text-purple-700">
            {mcRetBand
              ? formatCurrency(deflate(mcRetBand.p50, mcRetBand.year))
              : formatCurrency(nestEgg)}
          </div>
          {mcRetBand && (
            <div className="text-[10px] text-purple-400">
              Range {formatCurrency(deflate(mcRetBand.p25, mcRetBand.year))} –{" "}
              {formatCurrency(deflate(mcRetBand.p75, mcRetBand.year))}
            </div>
          )}
          <div className="text-[10px] text-faint mt-0.5">
            Baseline: {formatCurrency(nestEgg)}
          </div>
        </div>

        {/* Card 3: End Balance */}
        <div className="bg-surface-sunken rounded-lg p-4 text-center">
          <div className="text-xs text-muted uppercase font-medium">
            End Balance
          </div>
          <div className="text-lg font-bold text-primary">
            {formatCurrency(deflate(mc.medianEndBalance, terminalYear))}
          </div>
          <div className="text-[10px] text-muted">
            Sim. median at age {engineSettings?.endAge ?? "?"}
          </div>
          <div className="text-[10px] text-faint mt-0.5">
            {(() => {
              if (!result || result.projectionByYear.length === 0)
                return "Baseline: $0";
              const last =
                result.projectionByYear[result.projectionByYear.length - 1]!;
              return `Baseline: ${formatCurrency(deflate(last.endBalance, last.year))}`;
            })()}
          </div>
        </div>
      </div>
    );
  }

  // Deterministic hero (no MC)
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="bg-emerald-50 rounded-lg p-4 text-center">
        <div className="text-xs text-emerald-600 uppercase font-medium">
          {isPersonFiltered
            ? `${personFilterName}'s Nest Egg`
            : alreadyRetired
              ? "Current Portfolio"
              : "Nest Egg at Retirement"}
        </div>
        <div className="text-2xl font-bold text-emerald-700">
          {formatCurrency(nestEgg)}
        </div>
        <div className="text-[10px] text-emerald-500">
          {alreadyRetired
            ? `Age ${currentAge} (today's $)`
            : `Avg age ${engineSettings?.retirementAge ?? "?"}`}
        </div>
      </div>
      <div className="bg-blue-50 rounded-lg p-4 text-center">
        <div className="text-xs text-blue-600 uppercase font-medium">
          {isPersonFiltered ? `${personFilterName}'s Peak` : "Peak Balance"}
        </div>
        <div className="text-2xl font-bold text-blue-700">
          {formatCurrency(peakBalance)}
        </div>
        <div className="text-[10px] text-blue-500">
          Maximum projected balance
        </div>
      </div>
      <div className="bg-surface-sunken rounded-lg p-4 text-center">
        <div className="text-xs text-muted uppercase font-medium">
          {isPersonFiltered
            ? `${personFilterName}'s Funding`
            : "Funding Duration"}
        </div>
        <div className="text-2xl font-bold">
          {depl ? `Age ${depl.age}` : "Lasts \u2713"}
        </div>
        <div className="text-[10px] text-faint">
          {depl
            ? `Runs out ${depl.year}`
            : `Through age ${engineSettings?.endAge ?? "?"}`}
        </div>
      </div>
    </div>
  );
}
