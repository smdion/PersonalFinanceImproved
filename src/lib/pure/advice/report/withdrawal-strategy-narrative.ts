/** "Why this account, why this order" helpers shared by the advisor report and the table
 *  tooltips (re-exported from components/retirement-projection/utils.ts). Callers pass
 *  amounts already in the page's dollar mode. */
import type { EngineDecumulationYear } from "@/lib/pure/engine/types/index";
import type { BracketOptimizerResult } from "@/lib/pure/retirement/withdrawal-bracket-optimizer";
import type { WithdrawalSourceKind } from "@/lib/pure/engine";
import { formatPercent, formatCurrency } from "@/lib/utils/format";
import type { ReportWithdrawalStrategySection } from "./types";
import {
  describeBracketTargetChoice,
  describeDiscretionaryCapacityMath,
} from "./bracket-target-narrative";

const TIER_SOURCE_LABEL: Record<WithdrawalSourceKind, string> = {
  roth: "Roth",
  brokerage: "Brokerage",
  hsa: "HSA",
};

/** What kind of rate a tier's `costRate` is (Roth basis free; growth and brokerage gains
 *  at the household's rates, +3.8% over the surtax line). `source` can't tell Roth basis
 *  from growth, so a $0-cost Roth entry names both possibilities. */
function describeTierRate(
  source: WithdrawalSourceKind,
  costRate: number,
  includesNiit: boolean,
): string {
  if (costRate <= 0) {
    if (source === "roth") {
      return "cheapest available — already-taxed Roth contributions are always tax-free, or this is Roth growth taxed at your current 0% bracket";
    }
    // lint-violation-ok: `source` is WithdrawalTier's cost-ranking kind, not
    // an AccountCategory; the strings overlap, so no account-types.ts
    // predicate applies.
    if (source === "brokerage") {
      return "cheapest available — inside your 0% capital-gains bracket, so these gains aren't taxed";
    }
    return "cheapest available";
  }
  if (source === "roth") {
    return `Roth growth taxed at your ${formatPercent(costRate, 1)} ordinary income rate (not your tax-free contributions)`;
  }
  // lint-violation-ok: see the "roth"/"brokerage" note above — same
  // WithdrawalTier source kind, not an AccountCategory.
  if (source === "hsa") {
    return `taxed at your ${formatPercent(costRate, 1)} ordinary income rate (a non-medical HSA withdrawal)`;
  }
  // brokerage — the ranking says which rate it priced
  // (withdrawal-cost-ranking.ts), so nothing is inferred from the number.
  if (includesNiit) {
    return `${formatPercent(costRate, 1)} — your long-term capital-gains rate plus the 3.8% Medicare surtax, since this draw crosses that income threshold`;
  }
  return `${formatPercent(costRate, 1)} long-term capital-gains rate`;
}

/**
 * "Why was this account used" for a year's discretionary withdrawals, read straight off
 * `discretionaryTierBreakdown` rather than re-derived from amounts.
 */
export function formatDiscretionaryTierBreakdown(
  breakdown:
    | {
        source: WithdrawalSourceKind;
        costRate: number;
        amount: number;
        includesNiit?: true;
      }[]
    | undefined,
): string | undefined {
  if (!breakdown || breakdown.length === 0) return undefined;
  // A tier with no real price (no filing status to rank by) isn't
  // explained as a rate.
  const parts = breakdown
    .filter((t) => Number.isFinite(t.costRate))
    .map((t) => {
      const rate = describeTierRate(t.source, t.costRate, !!t.includesNiit);
      return `${formatCurrency(t.amount)} ${TIER_SOURCE_LABEL[t.source]} (${rate})`;
    });
  if (parts.length === 0) return undefined;
  return `Household-wide, beyond the bracket target, cheapest source first: ${parts.join(" → ")}`;
}

/**
 * "Why is my RMD this amount": Uniform Lifetime divisor × prior year-end balance, per person
 * from `rmdByPerson` when present, else the household `rmdDivisor`/`priorYearEndTradBalance`.
 */
export function formatRmdDivisorDetail(
  yearRow: {
    rmdByPerson?: {
      personName: string;
      divisor?: number;
      priorYearEndTradBalance?: number;
    }[];
    rmdDivisor?: number;
    priorYearEndTradBalance?: number;
  },
  deflate: (v: number, year: number) => number,
  year: number,
): string | undefined {
  const perPerson = yearRow.rmdByPerson?.filter(
    (p) => p.divisor != null && p.priorYearEndTradBalance != null,
  );
  if (perPerson && perPerson.length > 0) {
    return perPerson
      .map(
        (p) =>
          `${p.personName}: balance ${formatCurrency(deflate(p.priorYearEndTradBalance!, year))} ÷ ${p.divisor!.toFixed(1)}`,
      )
      .join(" · ");
  }
  if (yearRow.rmdDivisor != null && yearRow.priorYearEndTradBalance != null) {
    return `Balance ${formatCurrency(deflate(yearRow.priorYearEndTradBalance, year))} ÷ ${yearRow.rmdDivisor.toFixed(1)} (IRS Uniform Lifetime Table)`;
  }
  return undefined;
}

/**
 * Advisor report withdrawal strategy: a short paragraph plus sample years (first RMD, first
 * detailed discretionary year, up to 3 more), built from the tooltip formatters above.
 */
export function buildWithdrawalStrategyNarrative(
  decumulationYears: EngineDecumulationYear[],
  deflate: (v: number, year: number) => number,
  bracketOptimizerResult?: BracketOptimizerResult | null,
): ReportWithdrawalStrategySection {
  const highlights: { year: number; detail: string }[] = [];

  const firstRmdYear = decumulationYears.find(
    (y) =>
      (y.rmdDivisor != null || (y.rmdByPerson?.length ?? 0) > 0) &&
      formatRmdDivisorDetail(y, deflate, y.year) != null,
  );
  if (firstRmdYear) {
    highlights.push({
      year: firstRmdYear.year,
      detail: `Required Minimum Distribution begins: ${formatRmdDivisorDetail(firstRmdYear, deflate, firstRmdYear.year)}`,
    });
  }

  const firstDiscretionaryYear = decumulationYears.find(
    (y) =>
      formatDiscretionaryTierBreakdown(y.discretionaryTierBreakdown) != null,
  );
  if (firstDiscretionaryYear) {
    const fdy = firstDiscretionaryYear;
    // Deflated: describeDiscretionaryCapacityMath's figures share this sentence,
    // so both must be in the same dollar mode.
    const deflatedBreakdown = fdy.discretionaryTierBreakdown?.map((t) => ({
      ...t,
      amount: deflate(t.amount, fdy.year),
    }));
    const breakdownDetail =
      formatDiscretionaryTierBreakdown(deflatedBreakdown)!;
    // "Why isn't brokerage draining before Roth"
    // — shares describeDiscretionaryCapacityMath with the table tooltip so
    // the two can never disagree.
    const capacityDetail = describeDiscretionaryCapacityMath(
      fdy.rothBasisCapacity != null && fdy.brokerageZeroLtcgCapacity != null
        ? {
            rothBasisCapacity: deflate(fdy.rothBasisCapacity, fdy.year),
            brokerageZeroLtcgCapacity: deflate(
              fdy.brokerageZeroLtcgCapacity,
              fdy.year,
            ),
          }
        : undefined,
      deflatedBreakdown,
      fdy.config.discretionaryWithdrawalOrder,
      fdy.rmdOverrodeRouting,
    );
    highlights.push({
      year: firstDiscretionaryYear.year,
      detail: capacityDetail
        ? `${breakdownDetail} ${capacityDetail}`
        : breakdownDetail,
    });
  }

  const hasRmdYears = decumulationYears.some(
    (y) => y.rmdDivisor != null || (y.rmdByPerson?.length ?? 0) > 0,
  );
  const hasDiscretionaryYears = decumulationYears.some(
    (y) => (y.discretionaryTierBreakdown?.length ?? 0) > 0,
  );

  // Names the target rate (`rothBracketTarget`) and why, via the shared
  // describeBracketTargetChoice the table tooltip also calls; numeric when the
  // optimizer result exists, qualitative otherwise.
  const bracketTargetYear = decumulationYears.find(
    (y) => y.config.rothBracketTarget != null,
  );
  const bracketTarget = bracketTargetYear?.config.rothBracketTarget;
  const bracketTargetSentence =
    bracketTarget != null
      ? describeBracketTargetChoice(
          bracketOptimizerResult,
          bracketTarget,
          bracketTargetYear?.bracketTraditionalCap != null
            ? {
                // Deflated to today's dollars like every other figure here
                // (these are grown by bracket-growth.ts).
                bracketTraditionalCap: deflate(
                  bracketTargetYear.bracketTraditionalCap,
                  bracketTargetYear.year,
                ),
                taxableSS: deflate(
                  bracketTargetYear.taxableSS,
                  bracketTargetYear.year,
                ),
                // The grown per-year deduction, matching the grown
                // bracketTraditionalCap (not the ungrown plan-level echo).
                standardDeduction:
                  bracketTargetYear.standardDeduction != null
                    ? deflate(
                        bracketTargetYear.standardDeduction,
                        bracketTargetYear.year,
                      )
                    : bracketTargetYear.standardDeduction,
              }
            : undefined,
        )
      : undefined;

  let narrative: string;
  if (hasRmdYears && hasDiscretionaryYears) {
    narrative =
      "Your withdrawal strategy fills your target tax bracket from Traditional accounts first, then draws " +
      "any remaining need from whichever account costs the least in taxes — Roth basis and brokerage gains " +
      "in your 0% capital-gains room first, then the next-cheapest source. Once you reach the age the IRS " +
      "requires distributions, those are factored in automatically.";
  } else if (hasDiscretionaryYears) {
    narrative =
      "Your withdrawal strategy fills your target tax bracket from Traditional accounts first, then draws " +
      "any remaining need from whichever account costs the least in taxes — Roth basis and brokerage gains " +
      "in your 0% capital-gains room first, then the next-cheapest source.";
  } else {
    narrative =
      "Your withdrawal strategy fills your target tax bracket from Traditional accounts first to meet your " +
      "spending need for the year.";
  }

  return {
    narrative: bracketTargetSentence
      ? `${bracketTargetSentence} ${narrative}`
      : narrative,
    highlights,
  };
}
