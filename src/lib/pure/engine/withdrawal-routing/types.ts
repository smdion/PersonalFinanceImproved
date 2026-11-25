/** Routing's bracket input and the result every mode returns. */
import type { DecumulationSlot } from "../types/routing";
import type { WithholdingBracket } from "../tax-estimation";
import type { WithdrawalSourceKind } from "../draw-position";
import type { ReturnFilingStatus } from "@/lib/config/filing-status";

export interface RouteBracketInfo {
  taxBrackets?: WithholdingBracket[];
  rothBracketTarget?: number;
  /** The rate this year's Roth conversion targets when it differs from
   *  rothBracketTarget (plan-level or per-year override; decumulation-year.ts's
   *  resolvedConversionTarget). Omitted ⇒ rothBracketTarget. */
  conversionTarget?: number;
  taxableSS: number;
  /** Inputs to the bracket_filling cost ranking below. Omitted ⇒ fixed
   *  Roth→brokerage→HSA order; no filingStatus skips LTCG/NIIT lookups. */
  filingStatus?: ReturnFilingStatus | null;
  ltcgBrackets: Record<string, { threshold: number | null; rate: number }[]>;
  /** Roth basis left in the accounts routing draws from (tracked per account).
   *  Omitted ⇒ the whole Roth balance counts as basis; 0 ⇒ none remains. */
  rothBasisAvailable?: number;
  /** The `pro_rata` Roth (a designated Roth 401(k)/403(b)) routing draws from:
   *  balance, unqualified owners' basis, qualified owners' balance. */
  rothProRata?: { balance: number; basis: number; qualifiedBalance: number };
  /** This year's gross Social Security, and the provisional income beside it
   *  that routing doesn't draw (a gap year's wages; 0 otherwise). */
  ssIncome?: { gross: number; otherIncome: number };
  /** `afterTaxBasis / afterTax` for brokerage, 0..1. Omitted/0 ⇒ every
   *  brokerage dollar is treated as a taxable gain (conservative). */
  brokerageBasisRatio?: number;
  /** MAGI before this year's gains/growth, for the NIIT. Omitted ⇒ the
   *  ordinary-income floor stands in (high when other MAGI add-ins exist). */
  magiBeforeThisDraw?: number;
  /** Whether this year's Roth conversion runs: bracket filling then reserves
   *  the Traditional room Phase 1 left unused, which the conversion claims. */
  conversionsEnabled?: boolean;
  /** Traditional the conversion can draw on before this year's draws
   *  (`convertiblePreTax`); the reservation never passes it. Omitted ⇒ no cap. */
  conversionSource?: number;
  /** Household's annual standard deduction: gross ordinary income to taxable
   *  income for LTCG lookups (`ltcgStackBase`); omitted subtracts nothing. */
  standardDeduction?: number;
  /** Which free source goes first. Undefined ⇒ "roth_first". */
  discretionaryWithdrawalOrder?: "roth_first" | "brokerage_first";
  /** The tax multiplier the walk prices with (`DrawState.taxMultiplier`). */
  taxMultiplier?: number;
}

export type RouteResult = {
  slots: DecumulationSlot[];
  warnings: string[];
  traditionalCap?: number;
  unmetNeed?: number;
  /** What the penalty-exposed money left out of the draw could cover of
   *  `unmetNeed`: `min(unmetNeed, still-excluded exposure)`. It overlaps
   *  `nonRetirementShortfall`: each is at most `unmetNeed`, never added. */
  penaltyAvoidedShortfall?: number;
  /** What the Portfolio-parented money left out of the draw could cover of
   *  `unmetNeed`: `min(unmetNeed, nonRetirement.grandTotal)`. */
  nonRetirementShortfall?: number;
  /** bracket_filling only: drawn tiers (amount > 0) beyond the Traditional
   *  target, in draw order at their cost: `walkDiscretionaryDraw`'s segments.
   *  Feeds the "why was this account used" explanation. */
  tierBreakdown?: {
    source: WithdrawalSourceKind;
    costRate: number;
    amount: number;
    /** See `DrawSegment.includesNiit`. */
    includesNiit?: true;
  }[];
  /** Both free tiers' capacity before any draw, from `freeDrawCapacities`, so
   *  room the year never reached still shows. bracket_filling only, like
   *  `tierBreakdown`. */
  rothBasisCapacity?: number;
  brokerageZeroLtcgCapacity?: number;
};
