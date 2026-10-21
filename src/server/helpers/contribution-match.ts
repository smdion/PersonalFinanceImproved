/**
 * Employer match: one account's match (computeEmployerMatch), a Roth +
 * Traditional pair capped together as one account (computeGroupedEmployerMatch),
 * and which match groups count the bonus check (matchPayGroupsWithBonus).
 */
import type { MatchTaxTreatment } from "@/lib/config/enum-values";
import { rowTakesFromBonusCheck } from "@/lib/calculators/paycheck";

/**
 * Compute annual employer match from DB contribution row fields.
 * When maxMatchPct is 0 or unset, treat as no cap (unlimited match).
 */
export function computeEmployerMatch(
  matchType: string | null,
  matchValue: number,
  maxMatchPct: number,
  empContribAnnual: number,
  empContribMethod: string,
  empContribValue: number,
  salary: number,
): number {
  if (!matchType || matchType === "none") return 0;

  if (matchType === "percent_of_contribution") {
    if (salary <= 0) return 0;
    const matchRate = matchValue / 100;
    const empPct =
      empContribMethod === "percent_of_salary"
        ? empContribValue / 100
        : empContribAnnual / salary;
    const cappedPct = maxMatchPct > 0 ? Math.min(empPct, maxMatchPct) : empPct;
    return salary * cappedPct * matchRate;
  }
  if (matchType === "dollar_match") {
    return matchValue;
  }
  if (matchType === "fixed_annual") {
    return matchValue;
  }
  return 0;
}

/**
 * Minimal row shape `computeGroupedEmployerMatch` needs — any call site
 * adapts its own richer row type down to this before calling.
 */
export type GroupableMatchRow = {
  id: number;
  jobId: number | null;
  personId: number | null;
  accountType: string;
  parentCategory: string;
  /** This row's own annual contribution, already computed by the caller
   *  (via computeAnnualContribution) against `salary` below. */
  annual: number;
  /** The salary this row's contribution is measured against. Every row in
   *  the same group is expected to resolve to the same salary (they're the
   *  same physical account's tax-treatment splits, on the same job) — a
   *  mismatch is treated as a data-resolution bug, not silently averaged. */
  salary: number;
  employerMatchType: string | null;
  employerMatchValue: number;
  /** Fraction (e.g. 0.06 for 6%), not a whole-number percent — matches how
   *  computeEmployerMatch already reads it. */
  employerMaxMatchPct: number;
  employerMatchTaxTreatment: MatchTaxTreatment;
};

export type GroupedMatchResult = {
  matchAnnual: number;
  /** The match at the plan's cap (contributing at least the capped
   *  percent of pay) — the most the employer would put in. */
  matchAvailableAnnual: number;
  employerMatchTaxTreatment: MatchTaxTreatment;
};

/**
 * Compute employer match per row, correctly combining Roth/Traditional
 * splits of the same physical account before applying the match cap.
 *
 * `computeEmployerMatch` caps a single row against ONLY that row's own
 * contribution — correct for an account with no tax-treatment split, wrong
 * the moment one physical account is split into a Roth row + a Traditional
 * row (same job/person + accountType), since a real employer match cap
 * applies to the account's combined contribution, not each split
 * separately. This groups rows by resolved job (falling back to person —
 * matches every caller's existing jobless-account convention) +
 * accountType + parentCategory, resolves the single row that's allowed to
 * carry real match config for that group, applies the cap once against the
 * group's combined annual contribution, then redistributes the resulting
 * total back onto each row proportionally by its own contribution share
 * (same distribution math previously only used for display).
 *
 * parentCategory is part of the grouping key so match dollars can never
 * silently cross between Retirement/Portfolio buckets — if a data entry
 * mistake gives two real splits of the same account different
 * parentCategory values, they're treated as separate (unfixed, per-row
 * capped) groups rather than combined.
 *
 * At most one row per group may have a real (`!== "none"`) match type —
 * enforced at the DB layer (see migration adding a partial unique index),
 * but this throws defensively if it somehow arrives here anyway, rather
 * than silently falling back to the broken per-row computation (that
 * fallback would itself be a second computation path, and would invent a
 * number for genuinely ambiguous config instead of surfacing the problem).
 */
/** One physical account's match group: its job (or person, for an account
 *  with no job) + account type + parent category. The match is capped per
 *  group (computeGroupedEmployerMatch) and figured on the group's pay
 *  (matchPayGroupsWithBonus). */
export function matchGroupKey(r: {
  jobId: number | null;
  personId: number | null;
  accountType: string;
  parentCategory: string | null;
}): string {
  const jobKey = r.jobId != null ? `job:${r.jobId}` : `person:${r.personId}`;
  return `${jobKey}:${r.accountType}:${r.parentCategory}`;
}

/**
 * The match groups whose bonus check takes a deferral (rowTakesFromBonusCheck
 * on any of the group's rows — a Roth/Traditional pair is one account). The
 * employer matches what's deferred, on the pay it came from: a group's match
 * is figured on base salary, plus the bonus for these groups only. The one
 * rule for the match's pay — every match path uses it.
 */
export function matchPayGroupsWithBonus(
  rows: readonly {
    jobId: number | null;
    personId: number | null;
    accountType: string;
    parentCategory: string | null;
    isPayrollDeducted?: boolean | null;
    fromBonus?: boolean | null;
  }[],
): Set<string> {
  return new Set(rows.filter(rowTakesFromBonusCheck).map(matchGroupKey));
}

export function computeGroupedEmployerMatch(
  rows: GroupableMatchRow[],
): Map<number, GroupedMatchResult> {
  const groups = new Map<string, GroupableMatchRow[]>();
  for (const r of rows) {
    const key = matchGroupKey(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const result = new Map<number, GroupedMatchResult>();
  groups.forEach((members) => {
    const configRows = members.filter(
      (m) => m.employerMatchType && m.employerMatchType !== "none",
    );

    if (configRows.length > 1) {
      throw new Error(
        `Multiple contribution_accounts rows (ids: ${configRows
          .map((r) => r.id)
          .join(", ")}) independently carry employer match config for the ` +
          `same account (job/person + accountType + parentCategory). At ` +
          `most one Roth/Traditional split of a physical account may hold ` +
          `match config — fix the account data before contributions can ` +
          `be computed correctly.`,
      );
    }

    if (configRows.length === 0) {
      for (const m of members) {
        result.set(m.id, {
          matchAnnual: 0,
          matchAvailableAnnual: 0,
          employerMatchTaxTreatment: m.employerMatchTaxTreatment,
        });
      }
      return;
    }

    const winner = configRows[0]!;
    const combinedAnnual = members.reduce((sum, m) => sum + m.annual, 0);

    for (const m of members) {
      if (Math.abs(m.salary - winner.salary) > 0.01) {
        throw new Error(
          `Contribution rows ${winner.id} and ${m.id} grouped as the same ` +
            `account (job/person + accountType + parentCategory) resolved ` +
            `to different salaries (${winner.salary} vs ${m.salary}) — the ` +
            `grouping key assumes siblings share one job's salary.`,
        );
      }
    }

    // Delegate the actual per-type match math to computeEmployerMatch
    // itself — passing the GROUP's combined annual contribution and a
    // method that isn't "percent_of_salary" (forcing computeEmployerMatch's
    // percent_of_contribution branch to derive its rate from
    // combinedAnnual/salary rather than a single row's own method/value).
    // This is computed once per group, not once per row — for dollar_match/
    // fixed_annual that's what prevents two independently-configured
    // sibling rows from each returning the full flat amount and doubling
    // it (prevented structurally here, and at the DB layer by the same
    // constraint that limits a group to at most one match-config row).
    const totalMatch = computeEmployerMatch(
      winner.employerMatchType,
      winner.employerMatchValue,
      winner.employerMaxMatchPct,
      combinedAnnual,
      "combined", // not "percent_of_salary" — see comment above
      0,
      winner.salary,
    );

    // The full match: the same formula with the group contributing at
    // least the capped percent of pay. Uncapped or flat matches can't go
    // higher than what's already captured.
    const capAnnual =
      winner.employerMaxMatchPct > 0
        ? winner.employerMaxMatchPct * winner.salary
        : combinedAnnual;
    const availableMatch = computeEmployerMatch(
      winner.employerMatchType,
      winner.employerMatchValue,
      winner.employerMaxMatchPct,
      Math.max(combinedAnnual, capAnnual),
      "combined",
      0,
      winner.salary,
    );

    for (const m of members) {
      const share =
        combinedAnnual > 0 ? m.annual / combinedAnnual : 1 / members.length;
      result.set(m.id, {
        matchAnnual: totalMatch * share,
        matchAvailableAnnual: availableMatch * share,
        // Match tax character is a plan property, not a per-split-row one
        // — every row in the group gets the winning row's value, never its
        // own (a Roth/Trad split shift must never reclassify match dollars).
        employerMatchTaxTreatment: winner.employerMatchTaxTreatment,
      });
    }
  });

  return result;
}
