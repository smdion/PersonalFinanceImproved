/** Routing's bracket input and the result every mode returns. */
import type { DecumulationSlot } from "../types/routing";
import type { WithholdingBracket } from "../tax-estimation";
import type { WithdrawalSourceKind } from "../withdrawal-cost-ranking";
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
  /** Roth basis left in the accounts routing draws from (individual tracking).
   *  Omitted ⇒ the whole Roth balance counts as basis; 0 means tracking
   *  confirms none remains. */
  rothBasisAvailable?: number;
  /** `afterTaxBasis / afterTax` for brokerage, 0..1. Omitted/0 ⇒ every
   *  brokerage dollar is treated as a taxable gain (conservative). */
  brokerageBasisRatio?: number;
  /** MAGI before this year's gains/growth, for the NIIT headroom check.
   *  Omitted ⇒ NIIT check uses the ordinary-income floor as a MAGI proxy
   *  (slightly conservative when other MAGI add-ins exist). */
  magiBeforeThisDraw?: number;
  /** Whether this year's Roth conversion runs. If so, bracket-filling reserves
   *  the Traditional room Phase 1 left unused, since the conversion will claim it,
   *  so the 0%-LTCG estimate doesn't count that headroom. */
  conversionsEnabled?: boolean;
  /** Household's annual standard deduction: converts the gross ordinary-income
   *  floor to taxable income for LTCG lookups (`ltcgStackBase`);
   *  omitted subtracts nothing. */
  standardDeduction?: number;
  /** See `RankWithdrawalTiersInput`'s field of the same
   *  name (`withdrawal-cost-ranking.ts`) for the full explanation.
   *  Undefined ⇒ "roth_first". */
  discretionaryWithdrawalOrder?: "roth_first" | "brokerage_first";
}

export type RouteResult = {
  slots: DecumulationSlot[];
  warnings: string[];
  traditionalCap?: number;
  unmetNeed?: number;
  /** Portion of `unmetNeed` caused by excluding penalty-exposed money rather
   *  than the household running out: `min(unmetNeed, still-excluded exposure)`.
   *  Both shortfall fields can be set at once. */
  penaltyAvoidedShortfall?: number;
  /** Portion of `unmetNeed` caused by excluding Portfolio-parented money:
   *  `min(unmetNeed, nonRetirement.grandTotal)`. */
  nonRetirementShortfall?: number;
  /** bracket_filling only: drawn tiers (amount > 0) beyond the Traditional
   *  target, in draw order at their cost, straight from `rankWithdrawalTiers`.
   *  Feeds the "why was this account used" explanation. */
  tierBreakdown?: {
    source: WithdrawalSourceKind;
    costRate: number;
    amount: number;
    /** See WithdrawalTier.includesNiit. */
    includesNiit?: true;
  }[];
  /** Both free tiers' capacity before any draw, from `rankWithdrawalTiers`, so
   *  room the year never reached still shows. bracket_filling only, like
   *  `tierBreakdown`. */
  rothBasisCapacity?: number;
  brokerageZeroLtcgCapacity?: number;
};
