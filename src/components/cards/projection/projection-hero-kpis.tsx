"use client";

/** Hero KPI cards — MC-adaptive (success rate gauge, nest egg, funding outlook) or deterministic (nest egg, peak, duration). */
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency } from "@/lib/utils/format";
import type { useProjectionState } from "./use-projection-state";

type ProjectionState = ReturnType<typeof useProjectionState>;

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

  if (mc) {
    // MC-primary hero
    const pct = Math.round(mc.successRate * 100);
    const gaugeColor =
      pct >= 90
        ? "text-green-600"
        : pct >= 75
          ? "text-yellow-600"
          : pct >= 50
            ? "text-orange-500"
            : "text-red-600";
    const gaugeBg =
      pct >= 90
        ? "bg-green-50"
        : pct >= 75
          ? "bg-yellow-50"
          : pct >= 50
            ? "bg-orange-50"
            : "bg-red-50";
    const gaugeRing =
      pct >= 90
        ? "stroke-green-500"
        : pct >= 75
          ? "stroke-yellow-500"
          : pct >= 50
            ? "stroke-orange-500"
            : "stroke-red-500";
    const circumference = 2 * Math.PI * 40;
    const dashOffset = circumference * (1 - mc.successRate);

    return (
      <div className="grid grid-cols-3 gap-4">
        {/* Card 1: Success Rate gauge */}
        <div
          className={`${gaugeBg} rounded-lg p-4 flex flex-col items-center justify-center`}
        >
          <div className="relative w-20 h-20">
            <svg className="w-20 h-20 -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                strokeWidth="8"
                className="stroke-gray-200"
              />
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                strokeWidth="8"
                className={gaugeRing}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className={`text-xl font-bold ${gaugeColor}`}>{pct}%</span>
            </div>
          </div>
          <div className="text-xs text-muted mt-1 text-center">
            Success Rate
            <HelpTip text="Percentage of simulated scenarios where your money lasts through your full projection." />
          </div>
          <div className="text-[10px] text-faint mt-0.5">
            Det: {depl ? `Age ${depl.age}` : "Lasts \u2713"}
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
            Det: {formatCurrency(nestEgg)}
          </div>
        </div>

        {/* Card 3: Funding Outlook */}
        <div className="bg-surface-sunken rounded-lg p-4 text-center">
          <div className="text-xs text-muted uppercase font-medium">
            Funding Outlook
          </div>
          <div className="text-lg font-bold text-primary">
            {mc.distributions.depletionAge
              ? `${Math.round((1 - mc.successRate) * 100)}% risk`
              : "Fully Funded"}
          </div>
          <div className="text-[10px] text-muted">
            {mc.distributions.depletionAge
              ? `Median depletion age ${Math.round(mc.distributions.depletionAge.median)}`
              : `Money lasts in ${pct}% of futures`}
          </div>
          <div className="text-[10px] text-faint mt-0.5">
            MC end bal:{" "}
            {formatCurrency(deflate(mc.medianEndBalance, terminalYear))}
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
