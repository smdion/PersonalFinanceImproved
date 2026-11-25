/**
 * Where a year's discretionary draw stands (ordinary income, gains stacked on
 * it, MAGI, Social Security's provisional income) and how one dollar from
 * each source moves it: the walk in `withdrawal-cost-ranking.ts` prices from here.
 */
import type { WithholdingBracket } from "./tax-estimation";
import { estimateEffectiveTaxRate } from "./tax-estimation";
import { computeLtcgTaxUnrounded, ltcgStackBase } from "@/lib/pure/tax/ltcg";
import { roundToCents } from "../../utils/math";
import { MAX_EFFECTIVE_TAX_RATE } from "../../constants";
import {
  SS_TAX_TIER1_INCLUSION_RATE,
  SS_TAX_TIER2_INCLUSION_RATE,
  ssTaxThresholdsFor,
} from "../../config/ss-tax";
import type { ReturnFilingStatus } from "@/lib/config/filing-status";

export type WithdrawalSourceKind = "roth" | "brokerage" | "hsa";
/** Roth basis and growth (a `basis_first` Roth), a `pro_rata` Roth, brokerage, HSA. */
export type DrawPart =
  "rothBasis" | "rothGrowth" | "rothProRata" | "brokerage" | "hsa";
/** What each source can give. */
export type DrawSources = Record<DrawPart, number>;

/** Where this year's discretionary draw starts, and the year's tables. */
export interface DrawState {
  filingStatus: ReturnFilingStatus | null | undefined;
  /** Gross ordinary income in the stack (Traditional, taxable SS, reserved
   *  conversion room); this draw's taxed dollars add to it. */
  ordinaryIncome: number;
  /** Long-term gains this draw has realized, stacked on the ordinary income. */
  gains: number;
  /** MAGI, for the NIIT: before this draw, plus what it has drawn. */
  magi: number;
  taxBrackets: WithholdingBracket[];
  ltcgBrackets: Record<string, { threshold: number | null; rate: number }[]>;
  /** Gross to taxable income for the gains stack; undefined subtracts nothing. */
  standardDeduction?: number;
  /** 0..1: the share of a brokerage withdrawal that is basis, not gain. */
  brokerageBasisRatio: number;
  /** 0..1: the share of a `pro_rata` Roth withdrawal that is taxed growth. */
  rothProRataTaxableShare: number;
  /** Gross benefits and the provisional income so far (IRS Pub 915), with a
   *  filing status: income drawn also makes benefits taxable. Omitted ⇒ none. */
  socialSecurity?: { gross: number; provisionalIncome: number };
  /** Which free source goes first (0% gains still count toward MAGI). */
  discretionaryWithdrawalOrder?: "roth_first" | "brokerage_first";
  /** The tax multiplier: scales ordinary and gains tax, not the NIIT, as
   *  computeTaxFromSlots does. Omitted ⇒ 1. */
  taxMultiplier?: number;
}

/** A position or edge in whole cents (`roundToCents`), so a grown table's
 *  unrounded edge and a floor rounded to it compare equal. */
export const cents = (dollars: number) =>
  Math.round(roundToCents(dollars) * 100);
/** Dollars from `at` to `target`, compared in cents; an open top is never reached. */
export const gap = (target: number, at: number) =>
  target === Infinity ? Infinity : (cents(target) - cents(at)) / 100;

export const gainShareOf = (s: DrawState) =>
  Math.max(0, 1 - s.brokerageBasisRatio);

/** The ordinary bracket the next dollar at gross income `income` is taxed in,
 *  by table index in cents: its rate and gross top (Infinity for the open top). */
export function ordinaryBracketAt(
  income: number,
  {
    taxBrackets: brackets,
    standardDeduction: deduction,
  }: Pick<DrawState, "taxBrackets" | "standardDeduction">,
): { rate: number; top: number; start: number; base: number } {
  // Rows start at their threshold plus the deduction's part the table leaves
  // out (`toOrdinaryBracketIncome`); under the first row nothing is taxed.
  const firstTaxed = brackets.find((b) => b.rate > 0);
  const untaxed =
    firstTaxed && deduction !== undefined
      ? Math.max(0, deduction - firstTaxed.threshold)
      : 0;
  if (cents(income) < cents(untaxed))
    return { rate: 0, top: untaxed, start: 0, base: 0 };
  // The row in force is the latest start at or under `income` (the last such
  // row on a tie); the top is the nearest start above it, rows in any order.
  let rate = 0;
  let start = -Infinity;
  let base = 0;
  let top = Infinity;
  for (const b of brackets) {
    const from = b.threshold + untaxed;
    if (cents(from) > cents(income)) top = Math.min(top, from);
    else if (from >= start)
      [start, rate, base] = [from, b.rate, b.baseWithholding];
  }
  // `base` is the row's tax at its gross `start` (0 with no row in force).
  return { rate, top, start: Number.isFinite(start) ? start : 0, base };
}

/** The next ordinary dollar's cost at gross `income` under the multiplier k:
 *  k × its rate, or the 50% cap once k × the tax reaches half of gross income
 *  (`estimateEffectiveTaxRate`); `top` is where either changes. */
export function ordinaryCostAt(
  income: number,
  at: Pick<DrawState, "taxBrackets" | "standardDeduction" | "taxMultiplier">,
): { rate: number; top: number } {
  const k = at.taxMultiplier ?? 1;
  const row = ordinaryBracketAt(income, at);
  // In the row, k × tax − cap × income is a line; it is 0 at `cross`.
  const slope = k * row.rate - MAX_EFFECTIVE_TAX_RATE;
  const cross = (k * (row.rate * row.start - row.base)) / slope;
  const past = cents(income) >= cents(cross);
  const capped =
    slope === 0 ? row.base >= row.rate * row.start : slope > 0 ? past : !past;
  const edge = cents(cross) > cents(income) ? cross : Infinity;
  return {
    rate: capped ? MAX_EFFECTIVE_TAX_RATE : k * row.rate,
    top: slope === 0 ? row.top : Math.min(row.top, edge),
  };
}

/** The year's gains tax at `at` both ways Schedule D's worksheet line 25
 *  compares (`scaledGainsTax` takes the smaller), under the multiplier: stacked
 *  on the gains table, and as ordinary income. Unrounded: their gap rounds once. */
export function gainsTaxBothWays(
  at: DrawState,
  filingStatus: ReturnFilingStatus,
): { stacked: number; asOrdinary: number } {
  const { ordinaryIncome: o, gains: g, taxBrackets, standardDeduction } = at;
  const k = at.taxMultiplier ?? 1;
  const base = ltcgStackBase(o, standardDeduction, g);
  const ordinaryTax = (income: number) =>
    income *
    estimateEffectiveTaxRate(income, taxBrackets, k, standardDeduction);
  return {
    stacked:
      k *
      computeLtcgTaxUnrounded(
        base.ordinaryTaxable,
        base.taxedGains,
        filingStatus,
        at.ltcgBrackets,
      ),
    asOrdinary: ordinaryTax(o + g) - ordinaryTax(o),
  };
}

/** The share of the next dollar of provisional income that becomes taxable
 *  benefits (`computeTaxableSS`'s zones: 0, 50% or 85%, 0 past the 85% cap),
 *  and how much more provisional income keeps that share. */
export function socialSecurityInclusionAt(at: DrawState): {
  rate: number;
  room: number;
} {
  const benefits = at.socialSecurity;
  if (!benefits || !at.filingStatus) return { rate: 0, room: Infinity };
  const { gross, provisionalIncome: p } = benefits;
  const { tier1, tier2 } = ssTaxThresholdsFor(at.filingStatus);
  const half = SS_TAX_TIER1_INCLUSION_RATE;
  const most = SS_TAX_TIER2_INCLUSION_RATE;
  if (cents(p) < cents(tier1)) return { rate: 0, room: gap(tier1, p) };
  if (cents(p) < cents(tier2)) {
    // Half the income over tier 1 is taxable, up to half the benefits.
    const halfCap = tier1 + gross;
    return cents(p) < cents(halfCap)
      ? { rate: half, room: gap(Math.min(halfCap, tier2), p) }
      : { rate: 0, room: gap(tier2, p) };
  }
  const underTier2 = Math.min(half * (tier2 - tier1), half * gross);
  const cap = tier2 + (most * gross - underTier2) / most;
  return cents(p) < cents(cap)
    ? { rate: most, room: gap(cap, p) }
    : { rate: 0, room: Infinity };
}

/** What one dollar drawn adds to ordinary income, gains, MAGI and provisional
 *  income. */
export type DollarMove = {
  ordinary: number;
  gains: number;
  magi: number;
  provisional: number;
};

/** What a dollar from each part is: ordinary income (whole, or the pro_rata
 *  Roth's taxed share), long-term gains at the gain share, or untaxed. */
const PART_DOLLAR: Record<DrawPart, "ordinary" | "proRata" | "gains" | "free"> =
  {
    rothBasis: "free",
    rothGrowth: "ordinary",
    rothProRata: "proRata",
    brokerage: "gains",
    hsa: "ordinary",
  };
/** The part draws long-term gains (brokerage), not ordinary income. */
export const drawsGains = (part: DrawPart) => PART_DOLLAR[part] === "gains";

/** A dollar from `part`'s move, with `inclusion` of a dollar of benefits
 *  taxable per dollar of income. */
export function dollarMove(
  at: DrawState,
  part: DrawPart,
  inclusion: number,
): DollarMove {
  const taxed = (share: number) => ({
    ordinary: share * (1 + inclusion),
    gains: 0,
    magi: share * (1 + inclusion),
    provisional: share,
  });
  const kind = PART_DOLLAR[part];
  if (kind === "ordinary") return taxed(1);
  if (kind === "proRata") return taxed(at.rothProRataTaxableShare);
  if (kind === "gains") {
    const gain = gainShareOf(at);
    return {
      ordinary: gain * inclusion,
      gains: gain,
      magi: gain * (1 + inclusion),
      provisional: gain,
    };
  }
  return { ordinary: 0, gains: 0, magi: 0, provisional: 0 };
}

/** Moves `at` by `amount` drawn from `part`, zone by zone of Social Security. */
export function advance(at: DrawState, part: DrawPart, amount: number) {
  let rest = amount;
  for (let zone = 0; rest > 0; zone++) {
    const inclusion = socialSecurityInclusionAt(at);
    const move = dollarMove(at, part, inclusion.rate);
    const inZone =
      move.provisional > 0
        ? Math.min(rest, inclusion.room / move.provisional)
        : rest;
    // A zone with no room left, or past the three zones and their caps, takes the rest.
    const step = zone < 8 && inZone > 0 ? inZone : rest;
    at.ordinaryIncome += move.ordinary * step;
    at.gains += move.gains * step;
    at.magi += move.magi * step;
    if (at.socialSecurity)
      at.socialSecurity = {
        ...at.socialSecurity,
        provisionalIncome:
          at.socialSecurity.provisionalIncome + move.provisional * step,
      };
    rest -= step;
  }
}
