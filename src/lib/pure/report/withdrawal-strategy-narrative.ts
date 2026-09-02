/** "Why this account, why this order" narrative helpers for the retirement
 *  advisor report and, via re-export from components/cards/projection/utils.ts,
 *  the existing table/chart tooltips — moved here (not duplicated) so both
 *  callers can never drift (RULES.md single-computation-path). Pure
 *  formatters: callers pass already-deflated (real/nominal per the page's
 *  dollar-mode toggle) amounts, same convention as every other
 *  tooltip-string builder these were extracted from. */
import type { EngineDecumulationYear } from "@/lib/calculators/types/engine-projection";
import type { BracketOptimizerResult } from "@/lib/calculators/withdrawal-bracket-optimizer";
import { formatPercent, formatCurrency } from "@/lib/utils/format";
import type { ReportWithdrawalStrategySection } from "./types";
import {
  describeBracketTargetChoice,
  describeDiscretionaryCapacityMath,
} from "./bracket-target-narrative";
import { LTCG_BRACKETS as CONFIG_LTCG_BRACKETS } from "@/lib/config/tax-tables";
import { NIIT_RATE } from "@/lib/config/niit";

const TIER_SOURCE_LABEL: Record<"roth" | "brokerage" | "hsa", string> = {
  roth: "Roth",
  brokerage: "Brokerage",
  hsa: "HSA",
};

/** The real LTCG rates (0%, 15%, 20% — identical across filing statuses,
 *  so any one status's ladder works) and the NIIT surtax rate — used only
 *  to LABEL a brokerage tier's rate as "capital-gains" vs "capital-gains +
 *  Medicare surtax" for the explanation text below. Not a second pricing
 *  computation: withdrawal-cost-ranking.ts already computed `costRate`
 *  itself (`ltcgRate` or `ltcgRate + NIIT_RATE`); this only pattern-matches
 *  the result against the small, fixed set of values it could legitimately
 *  be, to describe it in words. See that module for the real rate logic.
 *  R43 (C9): derived from the config module instead of a re-declared
 *  literal, so a rate-ladder change (legislative only — these are
 *  statutory percentages, not annually-indexed) can't drift between the
 *  two copies. */
const LTCG_RATE_LADDER = CONFIG_LTCG_BRACKETS.MFJ.map((b) => b.rate);
const RATE_EPSILON = 0.0005;

function approxEquals(a: number, b: number): boolean {
  return Math.abs(a - b) < RATE_EPSILON;
}

/** Explains WHAT KIND of rate a tier's `costRate` is and WHY, not just the
 *  number — found live, 2026-08-31: a household asked "why is Roth cheaper
 *  than Brokerage" and the honest answer is tier-dependent (Roth BASIS is
 *  always free — already-taxed principal; Roth GROWTH is taxed at your
 *  ordinary rate; Brokerage's own 0%-capital-gains room is free, but real
 *  gains beyond it are taxed at your capital-gains rate, +3.8% once you
 *  cross the Medicare surtax threshold) — a plain "0%"/"X% marginal tax"
 *  figure doesn't say which case applies. `source` alone can't distinguish
 *  Roth basis from Roth growth (see this account's own eligibility note
 *  for that, e.g. "Rule of 55 met" for growth access) — for a $0-cost Roth
 *  entry this stays deliberately non-committal between the two truthful
 *  possibilities rather than guessing.
 */
function describeTierRate(
  source: "roth" | "brokerage" | "hsa",
  costRate: number,
): string {
  if (costRate <= 0) {
    if (source === "roth") {
      return "cheapest available — already-taxed Roth contributions are always tax-free, or this is Roth growth taxed at your current 0% bracket";
    }
    // `source` is WithdrawalTier's cost-ranking source kind, not an
    // AccountCategory — coincidentally overlapping strings, different
    // domain, no account-types.ts predicate applies. lint-violation-ok
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
  // brokerage
  const withNiit = LTCG_RATE_LADDER.some((b) =>
    approxEquals(costRate, b + NIIT_RATE),
  );
  const ltcgOnly = LTCG_RATE_LADDER.some((b) => approxEquals(costRate, b));
  if (withNiit) {
    return `${formatPercent(costRate, 1)} — your long-term capital-gains rate plus the 3.8% Medicare surtax, since this draw crosses that income threshold`;
  }
  if (ltcgOnly) {
    return `${formatPercent(costRate, 1)} long-term capital-gains rate`;
  }
  return `${formatPercent(costRate, 1)} marginal tax`;
}

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
  const parts = breakdown.map((t) => {
    const rate = describeTierRate(t.source, t.costRate);
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
    // Deflated (advisor review, 2026-08-31) — describeDiscretionaryCapacityMath's
    // new capacity figures sit right next to this breakdown in one
    // sentence, so both need the same dollar mode or "you had $X of room"
    // and "$Y came from Roth" silently mix real/nominal dollars.
    const deflatedBreakdown = fdy.discretionaryTierBreakdown?.map((t) => ({
      ...t,
      amount: deflate(t.amount, fdy.year),
    }));
    const breakdownDetail =
      formatDiscretionaryTierBreakdown(deflatedBreakdown)!;
    // "Why isn't brokerage draining before Roth" (found live, 2026-08-31)
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

  // "Why THIS bracket, not a lower or higher one" — found live, 2026-08-31:
  // the prior version of this narrative (and the matching table tooltip)
  // said "fills your target tax bracket" without ever naming the actual
  // rate. Reads the target off the resolved config's `rothBracketTarget`
  // (the same field the table tooltip already cites), then hands it to
  // the SHARED describeBracketTargetChoice (bracket-target-narrative.ts)
  // — the same function the table tooltip calls — so the report and the
  // tooltip can never disagree about why this rate was chosen. Folds in
  // the optimizer's real numeric comparison when available, falling back
  // to the qualitative-only version otherwise (query still loading,
  // Waterfall mode, or fewer than 2 comparable candidates).
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
                // Deflated to today's dollars — advisor-caught 2026-09-01:
                // every other figure in this narrative goes through
                // `deflate` (see the discretionary-tier detail above), but
                // these three were passed raw/nominal. bracketTargetYear
                // is typically 15-25 years into decumulation and these
                // figures are grown by bracket-growth.ts, so the report
                // was printing a nominal bracket-ceiling dollar amount
                // next to today's-dollar figures everywhere else in the
                // same document.
                bracketTraditionalCap: deflate(
                  bracketTargetYear.bracketTraditionalCap,
                  bracketTargetYear.year,
                ),
                taxableSS: deflate(
                  bracketTargetYear.taxableSS,
                  bracketTargetYear.year,
                ),
                // The GROWN per-year deduction (`bracket-growth.ts`), not
                // the ungrown plan-level echo — advisor-caught (2026-08-31):
                // pairing a grown bracketTraditionalCap with an ungrown
                // deduction in the same sentence was internally
                // inconsistent for any year beyond the tax data's vintage.
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
