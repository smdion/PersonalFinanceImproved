/** "Why this account, why this order" narrative helpers for the retirement
 *  advisor report and, via re-export from components/cards/projection/utils.ts,
 *  the existing table/chart tooltips — moved here (not duplicated) so both
 *  callers can never drift (RULES.md single-computation-path). Pure
 *  formatters: callers pass already-deflated (real/nominal per the page's
 *  dollar-mode toggle) amounts, same convention as every other
 *  tooltip-string builder these were extracted from. */
import type { EngineDecumulationYear } from "@/lib/calculators/types/engine-projection";
import { formatPercent, formatCurrency } from "@/lib/utils/format";
import type { ReportWithdrawalStrategySection } from "./types";

const TIER_SOURCE_LABEL: Record<"roth" | "brokerage" | "hsa", string> = {
  roth: "Roth",
  brokerage: "Brokerage",
  hsa: "HSA",
};

/**
 * Human-readable "why was this account used" explanation for a year's
 * discretionary (beyond-Traditional-bracket-cap) withdrawal routing. Reads
 * directly off `EngineDecumulationYear.discretionaryTierBreakdown`
 * (`RouteResult.tierBreakdown`, withdrawal-routing.ts) rather than
 * re-deriving the reasoning from dollar amounts.
 */
export function formatDiscretionaryTierBreakdown(
  breakdown:
    | {
        source: "roth" | "brokerage" | "hsa";
        costRate: number;
        amount: number;
      }[]
    | undefined,
): string | undefined {
  if (!breakdown || breakdown.length === 0) return undefined;
  // Deliberately NOT "free"/"0%" for a costRate of 0 — this sits right next
  // to per-account eligibility notes that already say "taxable" for the
  // same dollars (Roth basis genuinely is tax-free, but Roth GROWTH tier
  // entries can also legitimately show 0% here — the household-level "no
  // extra cost vs. the alternative" framing, not a claim about this
  // specific account's own tax treatment — see this account's own note for
  // that). "cheapest available" reads correctly in both cases.
  const parts = breakdown.map((t) => {
    const rate =
      t.costRate <= 0
        ? "cheapest available"
        : `${formatPercent(t.costRate, 1)} marginal tax`;
    return `${formatCurrency(t.amount)} ${TIER_SOURCE_LABEL[t.source]} (${rate})`;
  });
  return `Household-wide, beyond the bracket target, cheapest source first: ${parts.join(" → ")}`;
}

/**
 * "Why is my RMD this amount" — formats the IRS Uniform Lifetime Table
 * divisor × prior-year-end balance breakdown, per person when available
 * (`EngineDecumulationYear.rmdByPerson`), falling back to the household-
 * level `rmdDivisor`/`priorYearEndTradBalance` pair (single-person
 * households / no per-person RMD tracking). Reads the divisor/balance
 * fields the engine already computed rather than re-deriving them — see
 * `rmdByPerson`'s docblock (engine-projection.ts).
 */
export function formatRmdDivisorDetail(
  yr: {
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
  const perPerson = yr.rmdByPerson?.filter(
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
  if (yr.rmdDivisor != null && yr.priorYearEndTradBalance != null) {
    return `Balance ${formatCurrency(deflate(yr.priorYearEndTradBalance, year))} ÷ ${yr.rmdDivisor.toFixed(1)} (IRS Uniform Lifetime Table)`;
  }
  return undefined;
}

/**
 * Withdrawal-strategy section for the advisor report: a short narrative
 * paragraph plus a handful of the most informative per-year "why this
 * account" highlights (RMD divisor detail, discretionary-tier reasoning),
 * built from the same two formatters above so this can never disagree
 * with what the interactive table's tooltips already say.
 *
 * `decumulationYears` should be the household's real decumulation years
 * in order; this picks a small representative sample (first RMD year,
 * first discretionary-withdrawal year with real detail, and up to 3 more
 * spread across retirement) rather than every year — the full year-by-year
 * table is a separate report section (Phase 4).
 */
export function buildWithdrawalStrategyNarrative(
  decumulationYears: EngineDecumulationYear[],
  deflate: (v: number, year: number) => number,
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
    highlights.push({
      year: firstDiscretionaryYear.year,
      detail: formatDiscretionaryTierBreakdown(
        firstDiscretionaryYear.discretionaryTierBreakdown,
      )!,
    });
  }

  const hasRmdYears = decumulationYears.some(
    (y) => y.rmdDivisor != null || (y.rmdByPerson?.length ?? 0) > 0,
  );
  const hasDiscretionaryYears = decumulationYears.some(
    (y) => (y.discretionaryTierBreakdown?.length ?? 0) > 0,
  );

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

  return { narrative, highlights };
}
