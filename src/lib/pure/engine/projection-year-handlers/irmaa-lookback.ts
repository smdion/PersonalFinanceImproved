/** The IRMAA lookback: premium year N reads tax year N−2's MAGI
 *  (42 USC 1395r(i)(4)(B)(i); 20 CFR 418.1135). */
import { yearMagi, type YearIncome } from "@/lib/pure/tax/year-income";

/** One tax year as IRMAA reads it: its MAGI and the Roth conversion in it. */
export type IrmaaTaxYear = {
  year: number;
  magi: number;
  rothConversion: number;
};

/** The projection's tax years so far, by year. */
export type IrmaaTaxYears = Map<number, IrmaaTaxYear>;

/** The tax year premium year `year` reads (year − 2), once recorded. */
export function irmaaLookbackYear(
  taxYears: IrmaaTaxYears,
  year: number,
): IrmaaTaxYear | undefined {
  return taxYears.get(year - 2);
}

/** Records a decumulation year's income, then returns the tax year its
 *  premiums read: year − 2, or the year itself until that is recorded. */
export function irmaaTaxYearFor(
  taxYears: IrmaaTaxYears,
  year: number,
  income: YearIncome,
): IrmaaTaxYear {
  const own = {
    year,
    magi: yearMagi(income, "irmaa"),
    rothConversion: income.rothConversions,
  };
  taxYears.set(year, own);
  return irmaaLookbackYear(taxYears, year) ?? own;
}
