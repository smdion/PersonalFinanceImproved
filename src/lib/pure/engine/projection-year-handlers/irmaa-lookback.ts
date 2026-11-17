/** The IRMAA lookback: premium year N reads tax year N−2's MAGI
 *  (42 USC 1395r(i)(4)(B)(i); 20 CFR 418.1135). */
import { yearMagi, type YearIncome } from "@/lib/pure/tax/year-income";

/** One tax year as IRMAA reads it: its MAGI, the Roth conversion in it, and
 *  whether it was worked (it had wages). */
export type IrmaaTaxYear = {
  year: number;
  magi: number;
  rothConversion: number;
  worked: boolean;
};

/** The projection's tax years so far, by year. */
export type IrmaaTaxYears = Map<number, IrmaaTaxYear>;

/** The tax year premium year `year` reads: year − 2 once recorded. A year
 *  before the plan's first reads that first year when it was worked: the
 *  nearest return Ledgr has (the law reads three years back, 418.1135(b)). */
export function irmaaLookbackYear(
  taxYears: IrmaaTaxYears,
  year: number,
  planStartYear: number,
): IrmaaTaxYear | undefined {
  if (year - 2 >= planStartYear) return taxYears.get(year - 2);
  const first = taxYears.get(planStartYear);
  return first?.worked ? first : undefined;
}

/** Records a year's income as the tax year it is. */
export function recordIrmaaTaxYear(
  taxYears: IrmaaTaxYears,
  year: number,
  income: YearIncome,
): IrmaaTaxYear {
  const own = {
    year,
    magi: yearMagi(income, "irmaa"),
    rothConversion: income.rothConversions,
    worked: income.wages > 0,
  };
  taxYears.set(year, own);
  return own;
}
