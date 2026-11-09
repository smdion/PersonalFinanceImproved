/**
 * Money Guy's 60/40 rule by year (RAISE_RULE): for each finalized year whose salary
 * rose by at least the minimum, contribution change over salary change. Both years
 * need a salary and finalized contributions, or the year isn't judged.
 */
import { RAISE_RULE } from "@/lib/config/milestones";

export type RaiseYear = {
  year: number;
  /** Household salary change from the year before. */
  raise: number;
  /** Change in the household's own contributions (negative = saved less). */
  savingChange: number;
  /** savingChange ÷ raise. */
  share: number;
  /** Either year's contributions are still marked estimated. */
  estimated: boolean;
};

export function raiseHistory(
  salaryByYear: ReadonlyMap<number, number>,
  savingByYear: ReadonlyMap<number, { employee: number; estimated: boolean }>,
): RaiseYear[] {
  const out: RaiseYear[] = [];
  for (const year of [...salaryByYear.keys()].sort((a, b) => a - b)) {
    const pay = salaryByYear.get(year)!;
    const prevPay = salaryByYear.get(year - 1);
    const saved = savingByYear.get(year);
    const prevSaved = savingByYear.get(year - 1);
    if (prevPay === undefined || !saved || !prevSaved || prevPay <= 0) continue;
    const raise = pay - prevPay;
    if (raise < RAISE_RULE.minRaiseShare * prevPay) continue;
    const savingChange = saved.employee - prevSaved.employee;
    out.push({
      year,
      raise,
      savingChange,
      share: savingChange / raise,
      estimated: saved.estimated || prevSaved.estimated,
    });
  }
  return out;
}

export function meetsRaiseRule(r: RaiseYear): boolean {
  return r.share >= RAISE_RULE.saveShare;
}
