/**
 * Missing or inconsistent basis. Roth conversion basis is cumulative, so year Y's row must
 * hold at least the conversion basis a later row dates to Y; less means year Y understates it.
 */
import { HALF_CENT } from "@/lib/constants";
import { roundToCents } from "@/lib/utils/math";
import { tracksCostBasis } from "@/lib/config/account-types";

type BasisHistoryRow = {
  performanceAccountId: number;
  ownerPersonId: number | null;
  year: number;
  conversionBasis: number;
  latestConversionYear: number | null;
};

type BasisGap = {
  performanceAccountId: number;
  ownerPersonId: number | null;
  /** The year whose row is short. */
  year: number;
  recorded: number;
  /** What the later row implies it should be. */
  expected: number;
  /** The later row that names `year` as its latest conversion. */
  fromYear: number;
};

export function findBasisGaps(rows: readonly BasisHistoryRow[]): BasisGap[] {
  const gaps: BasisGap[] = [];
  const key = (r: BasisHistoryRow) =>
    `${r.performanceAccountId}:${r.ownerPersonId ?? ""}`;
  const groups = new Map<string, BasisHistoryRow[]>();
  for (const r of rows) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
  for (const group of groups.values()) {
    const byYear = new Map(group.map((r) => [r.year, r]));
    const seen = new Set<number>();
    for (const later of [...group].sort((a, b) => a.year - b.year)) {
      const y = later.latestConversionYear;
      if (y === null || y >= later.year || seen.has(y)) continue;
      const own = byYear.get(y);
      if (!own) continue;
      seen.add(y);
      if (own.conversionBasis + HALF_CENT < later.conversionBasis)
        gaps.push({
          performanceAccountId: later.performanceAccountId,
          ownerPersonId: later.ownerPersonId,
          year: y,
          recorded: roundToCents(own.conversionBasis),
          expected: roundToCents(later.conversionBasis),
          fromYear: later.year,
        });
    }
  }
  return gaps;
}

/**
 * Brokerage-style accounts holding money with no cost basis (0 can't tell "not entered"
 * from a real zero, and the projection taxes every dollar drawn as a gain).
 */
export function findMissingCostBasis<
  T extends { category: string; balance: number; costBasis: number },
>(accounts: readonly T[]): T[] {
  return accounts.filter(
    (a) =>
      tracksCostBasis(a.category) && a.balance >= 1 && a.costBasis < HALF_CENT,
  );
}

/** The projection's note for one such account. */
export function missingCostBasisWarning(name: string): string {
  return `${name} has no cost basis entered, so the projection taxes everything drawn from it as capital gains. Enter what you paid in the Performance page's Basis columns (Brokerage page for Portfolio accounts).`;
}
