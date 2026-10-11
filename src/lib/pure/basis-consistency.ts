/**
 * Year-to-year consistency of Roth conversion basis. Pure.
 *
 * Basis is cumulative: a row's conversion basis includes every conversion
 * up to its year. So when a later row says the latest conversion was in
 * year Y, year Y's own row must already hold at least that much conversion
 * basis (withdrawals only ever lower later rows). A smaller figure in year
 * Y means a conversion was entered on a later row but not on its own
 * year's — the year's history understates it.
 */
import { roundToCents } from "@/lib/utils/math";

export type BasisHistoryRow = {
  performanceAccountId: number;
  ownerPersonId: number | null;
  year: number;
  conversionBasis: number;
  latestConversionYear: number | null;
};

export type BasisGap = {
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
      if (own.conversionBasis + 0.005 < later.conversionBasis)
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
