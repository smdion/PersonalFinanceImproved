/** A Roth conversion's tax: the year's tax with it less the tax without it (IRC § 408A(d)(3)). */
import { roundToCents, safeDivide } from "../../utils/math";
import { MAX_EFFECTIVE_TAX_RATE } from "../../constants";
import { estimateEffectiveTaxRate } from "./tax-estimation";
import type { WithholdingBracket } from "./tax-estimation";

/** The year's tables a conversion's tax is priced on. */
export interface ConversionTaxTables {
  taxBrackets: WithholdingBracket[];
  taxMultiplier?: number;
  standardDeduction?: number;
}

/** The year's tax on `income` (gross), rounded to cents. */
function yearTax(income: number, t: ConversionTaxTables): number {
  if (income <= 0) return 0;
  return roundToCents(
    income *
      estimateEffectiveTaxRate(
        income,
        t.taxBrackets,
        t.taxMultiplier,
        t.standardDeduction,
      ),
  );
}

/** The largest gross income whose year tax (`estimateEffectiveTaxRate` × income: the brackets'
 *  piecewise-linear schedule × the multiplier, capped at MAX_EFFECTIVE_TAX_RATE) is at most
 *  `tax`, solved bracket by bracket. */
function incomeForTax(tax: number, t: ConversionTaxTables): number {
  const brackets = t.taxBrackets;
  const multiplier = t.taxMultiplier ?? 1;
  const first = brackets[0];
  // No brackets or no multiplier: the year is untaxed, any income fits.
  if (!first || multiplier <= 0) return Infinity;
  const firstTaxed = brackets.find((b) => b.rate > 0);
  const residual =
    t.standardDeduction == null
      ? 0
      : Math.max(
          0,
          t.standardDeduction - (firstTaxed ? firstTaxed.threshold : 0),
        );
  const target = safeDivide(tax, multiplier);
  // Below every bracket's base: the schedule is untaxed to the first threshold.
  let scheduleIncome = first.threshold;
  for (let i = brackets.length - 1; i >= 0; i--) {
    const b = brackets[i]!;
    if (b.baseWithholding > target) continue;
    const next = brackets[i + 1]?.threshold ?? Infinity;
    scheduleIncome =
      b.rate > 0
        ? Math.min(next, b.threshold + (target - b.baseWithholding) / b.rate)
        : next;
    break;
  }
  return Math.max(scheduleIncome + residual, tax / MAX_EFFECTIVE_TAX_RATE);
}

/** The conversion `cash` (the Retirement brokerage) pays the tax of, and that tax: the whole
 *  conversion when it covers it, else the largest whole-cent conversion whose tax, rounded as
 *  the engine rounds it, it can pay (0 when none), so a cent short never cancels the conversion. */
export function conversionTaxPaid(
  yearTaxableIncome: number,
  conversion: number,
  cash: number,
  t: ConversionTaxTables,
): { conversion: number; tax: number } {
  const tax = conversionTaxCost(yearTaxableIncome, conversion, t);
  if (cash >= tax) return { conversion, tax };
  const shrunk = largestConversionTaxPaid(
    yearTaxableIncome,
    conversion,
    cash,
    t,
  );
  return {
    conversion: shrunk,
    tax: shrunk > 0 ? conversionTaxCost(yearTaxableIncome, shrunk, t) : 0,
  };
}

/** The largest whole-cent conversion, at most `conversion`, whose rounded tax `cash` pays. */
function largestConversionTaxPaid(
  yearTaxableIncome: number,
  conversion: number,
  cash: number,
  t: ConversionTaxTables,
): number {
  const paid = Math.max(0, cash);
  // Solved on the unrounded tax without it, so the conversion's own tax is the cash.
  const taxWithout =
    yearTaxableIncome > 0
      ? yearTaxableIncome *
        estimateEffectiveTaxRate(
          yearTaxableIncome,
          t.taxBrackets,
          t.taxMultiplier,
          t.standardDeduction,
        )
      : 0;
  const solved = incomeForTax(taxWithout + paid, t);
  // In cents from here; `fits` is the engine's own rounded tax.
  const fits = (cents: number) =>
    conversionTaxCost(yearTaxableIncome, cents / 100, t) <= paid;
  const maxCents = Math.round(conversion * 100);
  let cents = Math.max(
    0,
    Math.min(maxCents, Math.floor((solved - yearTaxableIncome) * 100 + 1e-6)),
  );
  // The solve is exact on the unrounded tax: step down past float residue,
  // then up while the rounded tax still fits (doubling, then halving).
  for (let i = 0; cents > 0 && !fits(cents) && i < 100; i++) cents--;
  if (!fits(cents)) cents = 0;
  let step = 1;
  while (step < 2 ** 40 && cents + step <= maxCents && fits(cents + step)) {
    cents += step;
    step *= 2;
  }
  while (step > 1) {
    step /= 2;
    if (cents + step <= maxCents && fits(cents + step)) cents += step;
  }
  return cents / 100;
}

/** The incremental tax of converting `conversion` on top of `yearTaxableIncome`:
 *  tax(income + conversion) − tax(income), not effective_rate × conversion. */
export function conversionTaxCost(
  yearTaxableIncome: number,
  conversion: number,
  t: ConversionTaxTables,
): number {
  return roundToCents(
    Math.max(
      0,
      yearTax(yearTaxableIncome + conversion, t) -
        yearTax(yearTaxableIncome, t),
    ),
  );
}
