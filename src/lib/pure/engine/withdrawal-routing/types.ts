/** Routing's bracket input and the result every mode returns. */
import type { DecumulationSlot } from "../types/routing";
import type { WithholdingBracket } from "../tax-estimation";
import type { WithdrawalSourceKind } from "../withdrawal-cost-ranking";
import type { ReturnFilingStatus } from "@/lib/config/filing-status";

export interface RouteBracketInfo {
  taxBrackets?: WithholdingBracket[];
  rothBracketTarget?: number;
  /** The rate a same-year Roth conversion will actually target, when it
   *  differs from rothBracketTarget above (an explicit plan-level
   *  rothConversionTarget, or a per-year override — see
   *  decumulation-year.ts's resolvedConversionTarget). Falls back to
   *  rothBracketTarget when omitted, so existing callers that don't pass
   *  this (withdrawal-solver.ts's estimate) keep prior behavior exactly.
   *  conversionReservedRoom below used to
   *  reserve room up to rothBracketTarget's cap even when the conversion
   *  that actually runs targets a different, more specific rate — two
   *  names for one quantity, resolved by two different chains. */
  conversionTarget?: number;
  taxableSS: number;
  /** Below fields power the cost-aware post-bracket-cap ranking
   *  (bracket_filling mode only — see `routeWithdrawalsBracketFilling`,
   *  `withdrawal-cost-ranking.ts`). All optional: omitted ⇒ the ranking
   *  degrades to the fixed Roth→brokerage→HSA order (no
   *  filingStatus at all skips LTCG/NIIT lookups entirely; the others
   *  default to "no basis tracking / no MAGI headroom known"). */
  filingStatus?: ReturnFilingStatus | null;
  ltcgBrackets: Record<string, { threshold: number | null; rate: number }[]>;
  /** Total Roth BASIS dollars (tax-free, non-qualified-growth-free) still
   *  available across the accounts routing will draw from, from
   *  individual-account tracking. Omitted (not 0!) ⇒ the ranking treats
   *  the WHOLE Roth balance as basis (the "Roth is free" behavior when
   *  individual tracking isn't enabled) — pass 0 explicitly only when
   *  tracking IS enabled and genuinely confirms no basis remains. */
  rothBasisAvailable?: number;
  /** `afterTaxBasis / afterTax` for brokerage, 0..1. Omitted/0 ⇒ every
   *  brokerage dollar is treated as a taxable gain (conservative). */
  brokerageBasisRatio?: number;
  /** MAGI before this year's gains/growth, for the NIIT headroom check.
   *  Omitted ⇒ NIIT check uses the ordinary-income floor as a MAGI proxy
   *  (slightly conservative when other MAGI add-ins exist). */
  magiBeforeThisDraw?: number;
  /** Whether this year's Roth conversion optimizer
   *  (`performRothConversion`, roth-conversion.ts) is enabled —
   *  when true, `routeWithdrawalsBracketFilling` reserves any Traditional
   *  bracket room Phase 1 left unused (`traditionalCap - totalTradWithdrawn`)
   *  from the LTCG-room floor, since the conversion is unconditional and
   *  will claim that same room later this same year — otherwise routing's
   *  LTCG-0% estimate assumes headroom the conversion is about to consume.
   *  Deliberately NOT a duplicate computation of
   *  `performRothConversion`'s own room formula: Phase 1 already fills
   *  Traditional up to the identical `rothBracketTarget` cap using the
   *  identical balance data, so `traditionalCap - totalTradWithdrawn` IS
   *  that same "unused room" quantity, not an approximation of it. */
  conversionsEnabled?: boolean;
  /** Household's annual standard deduction: converts the gross ordinary-income
   *  floor to taxable income for LTCG lookups (`toLtcgTaxableIncome`);
   *  omitted subtracts nothing. */
  standardDeduction?: number;
  /** See `RankWithdrawalTiersInput`'s field of the same
   *  name (`withdrawal-cost-ranking.ts`) for the full explanation.

   *  Undefined ⇒ "roth_first", matching all pre-existing behavior. */
  discretionaryWithdrawalOrder?: "roth_first" | "brokerage_first";
}

export type RouteResult = {
  slots: DecumulationSlot[];
  warnings: string[];
  traditionalCap?: number;
  unmetNeed?: number;
  /** Portion of `unmetNeed` attributable specifically to excluding
   *  penalty-exposed money, not to the household being broke. Distinct
   *  from `unmetNeed` itself:
   *  a household can be short for BOTH reasons, or either alone — conflating
   *  them would destroy the distinction this whole feature exists to
   *  create. `min(unmetNeed, exposure.totalPenaltyExposed)` — never more
   *  than either the amount actually unfunded or the amount that was
   *  actually excluded. */
  penaltyAvoidedShortfall?: number;
  /** Portion of `unmetNeed` attributable specifically to excluding
   *  Portfolio-parented ("non-retirement") money. Same shape and
   *  same reasoning as `penaltyAvoidedShortfall` — a household can be
   *  short for this reason, the penalty-exclusion reason, both, or neither,
   *  and conflating any of them with plain "the household is broke" would
   *  destroy the distinction this field exists to preserve.
   *  `min(unmetNeed, nonRetirement.grandTotal)`. */
  nonRetirementShortfall?: number;
  /** How the discretionary need beyond Traditional's bracket-fill target
   *  was actually sourced, in draw order, at each tier's real cost —
   *  bracket_filling mode only (waterfall/percentage never rank by cost,
   *  so this is always empty there). Powers the "why was this account
   *  used" UI explanation: reads directly off `rankWithdrawalTiers`'
   *  own tiers (`withdrawal-cost-ranking.ts`) rather than re-deriving the
   *  reasoning from the resulting dollar amounts, so the explanation can
   *  never drift from what routing actually decided (RULES.md
   *  single-computation-path). Only tiers that were actually drawn from
   *  (amount > 0) are included. */
  tierBreakdown?: {
    source: WithdrawalSourceKind;
    costRate: number;
    amount: number;
    /** See WithdrawalTier.includesNiit. */
    includesNiit?: true;
  }[];
  /** The two zero-cost discretionary tiers' real capacity this year,
   *  computed BEFORE `discretionaryWithdrawalOrder` decides which drains
   *  first and before either is actually drawn from — so a tier that had
   *  real room but was never reached by the draw loop (e.g. Roth basis
   *  alone covered the year's need) still has its capacity visible, not
   *  silently discarded like `tierBreakdown` would. Passthrough of
   *  `rankWithdrawalTiers`' own return value (`withdrawal-cost-ranking.ts`)
   *  — see `RankedWithdrawalTiers`'s docblock for why this exists. Both are
   *  0 (bracket_filling mode with a resolvable bracket cap), not present,
   *  in waterfall/percentage modes — same scoping as `tierBreakdown`. */
  rothBasisCapacity?: number;
  brokerageZeroLtcgCapacity?: number;
};
