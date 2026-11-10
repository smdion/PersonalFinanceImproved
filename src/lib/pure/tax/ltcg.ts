// Long-term capital gains tax. Brackets are per filing status on total
// taxable income (ordinary + gains), passed in from the year's tax data.

import type { ReturnFilingStatus } from "@/lib/config/filing-status";
import type { LtcgBracketTable } from "@/lib/config/tax-tables";

/** Gross ordinary income against the standard deduction (senior additions
 *  included; undefined subtracts nothing): the ordinary taxable income gains
 *  stack on, and the deduction it leaves unused. Every stacking site reads it. */
export function ltcgStackBase(
  grossOrdinaryIncome: number,
  standardDeduction: number | undefined,
): { ordinaryTaxable: number; unusedDeduction: number } {
  const deduction = standardDeduction ?? 0;
  return {
    ordinaryTaxable: Math.max(0, grossOrdinaryIncome - deduction),
    unusedDeduction: Math.max(0, deduction - Math.max(0, grossOrdinaryIncome)),
  };
}

/** The filing status's brackets. Every complete year has every status
 *  (resolveTaxParams), so a missing one is a caller bug — never guessed. */
function bracketsFor(
  brackets: LtcgBracketTable,
  filingStatus: ReturnFilingStatus,
): { threshold: number; rate: number }[] {
  const raw = brackets[filingStatus];
  if (!raw || raw.length === 0)
    throw new Error(`No LTCG brackets for filing status ${filingStatus}`);
  // Normalize null thresholds to Infinity (the stored open top bracket).
  return raw.map((b) => ({ threshold: b.threshold ?? Infinity, rate: b.rate }));
}

/** The LTCG rate for income at `totalTaxableIncome` (ordinary + gains): the
 *  bracket it sits in, its ceiling included. One rate, not a blend across
 *  brackets; `computeLtcgTax` charges the stacked tax. */
export function getLtcgRate(
  totalTaxableIncome: number,
  filingStatus: ReturnFilingStatus,
  brackets: LtcgBracketTable,
): number {
  const table = bracketsFor(brackets, filingStatus);
  // The top bracket is open (ltcgBracketsSchema), so this always finds one.
  return (table.find((b) => totalTaxableIncome <= b.threshold) ?? table.at(-1)!)
    .rate;
}

/** The LTCG rate on the next dollar above `taxableIncome` (a bracket's ceiling
 *  excluded): prices a slice of gains that starts there, at one rate. Not
 *  `getLtcgRate`'s question (where a dollar sits), so the two stay separate. */
export function ltcgRateForNextDollar(
  taxableIncome: number,
  filingStatus: ReturnFilingStatus,
  brackets: LtcgBracketTable,
): number {
  const table = bracketsFor(brackets, filingStatus);
  return (table.find((b) => taxableIncome < b.threshold) ?? table.at(-1)!).rate;
}

/** Progressive LTCG tax: gains stack on ordinary taxable income across the
 *  brackets (MFJ 2026: $80,000 ordinary + $30,000 gains is $18,900 at 0% and
 *  $11,100 at 15%, $1,665). Rounded to cents. */
export function computeLtcgTax(
  ordinaryTaxableIncome: number,
  capitalGains: number,
  filingStatus: ReturnFilingStatus,
  brackets: LtcgBracketTable,
): number {
  if (capitalGains <= 0) return 0;
  const table = bracketsFor(brackets, filingStatus);

  let tax = 0;
  let gainsRemaining = capitalGains;
  // "floor" is the bottom of the current bracket segment for gains
  let floor = Math.max(0, ordinaryTaxableIncome);

  for (const b of table) {
    if (gainsRemaining <= 0) break;
    if (floor >= b.threshold) continue; // ordinary income already past this bracket

    const room = b.threshold - floor;
    const taxable = Math.min(gainsRemaining, room);
    tax += taxable * b.rate;
    gainsRemaining -= taxable;
    floor += taxable;
  }

  return Math.round(tax * 100) / 100; // round to cents
}

/** Gains room left before the stack rises above `targetRate`. LTCG brackets
 *  store each bracket's own ceiling (ordinary ones store the next floor), so
 *  `incomeCapForMarginalRate` can't stand in for this. */
export function ltcgRoomForRate(
  targetRate: number,
  ordinaryTaxableIncome: number,
  filingStatus: ReturnFilingStatus,
  brackets: LtcgBracketTable,
): number {
  const table = bracketsFor(brackets, filingStatus);
  for (const b of table) {
    // The first bracket at or above targetRate: its own ceiling is the room.
    if (b.rate >= targetRate) {
      return Math.max(0, b.threshold - ordinaryTaxableIncome);
    }
  }
  return Infinity;
}

/** A year's long-term gains tax (Schedule D Tax Worksheet): less the unused
 *  deduction, stacked on ordinary taxable income, at most their cost at
 *  ordinary rates above it (line 25). `ordinaryRate` is the engine's. */
export function scheduleDGainsTax<Bracket>(
  grossOrdinaryIncome: number,
  gains: number,
  filingStatus: ReturnFilingStatus,
  taxRates: {
    taxBrackets?: Bracket[];
    taxMultiplier?: number;
    standardDeduction?: number;
    ltcgBrackets: LtcgBracketTable;
  },
  ordinaryRate: (
    income: number,
    brackets: Bracket[],
    taxMultiplier?: number,
    standardDeduction?: number,
  ) => number,
): number {
  const base = ltcgStackBase(grossOrdinaryIncome, taxRates.standardDeduction);
  const stacked = computeLtcgTax(
    base.ordinaryTaxable,
    Math.max(0, gains - base.unusedDeduction),
    filingStatus,
    taxRates.ltcgBrackets,
  );
  const brackets = taxRates.taxBrackets;
  if (!brackets || brackets.length === 0) return stacked;
  const ordinaryTax = (income: number) =>
    income *
    ordinaryRate(
      income,
      brackets,
      taxRates.taxMultiplier,
      taxRates.standardDeduction,
    );
  return Math.min(
    stacked,
    ordinaryTax(grossOrdinaryIncome + gains) - ordinaryTax(grossOrdinaryIncome),
  );
}
