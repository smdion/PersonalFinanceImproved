/**
 * Early-withdrawal penalty cost.
 * Sibling of `roth-distribution-tax.ts`: consumes an already-computed
 * per-account penalty-exposure partition (`withdrawal-eligibility.ts`'s
 * `EligibilityRecord`) and an already-routed per-account withdrawal map —
 * it never re-slices or re-derives eligibility, it only multiplies.
 *
 * Deviation from the locked design doc, factual not judgment-based: the
 * doc calls for one uniform `EARLY_WITHDRAWAL_PENALTY_RATE = 0.10` "across
 * every account type this engine models." That is correct for Traditional/
 * Roth IRA and 401k/403b (IRC §72(t)) but wrong for HSA, whose non-medical
 * early-withdrawal penalty is legally 20% (IRC §223(f)(4)) — already
 * documented in this codebase's own `computeHsaAccess` docblock before this
 * pass existed. Applying 10% to HSA would understate a real cost for
 * exactly the account type this feature changes the most (see the design
 * doc's § S2 HSA caveat). See `HSA_NON_MEDICAL_PENALTY_RATE` in
 * `@/lib/constants` for the correction.
 */
import type { EligibilityRecord } from "@/lib/pure/withdrawal-eligibility";
import { isHsaCategory } from "@/lib/config/account-types";
import {
  EARLY_WITHDRAWAL_PENALTY_RATE,
  HSA_NON_MEDICAL_PENALTY_RATE,
} from "@/lib/constants";
import { roundToCents } from "@/lib/utils/math";

export type EarlyWithdrawalPenalty = {
  /** Sum of every account's penalty cost this year. */
  penaltyCost: number;
  /** Sum of every account's penalized (penalty-exposed and actually
   *  withdrawn) dollars this year. */
  penalizedAmount: number;
  byKey: Map<
    string,
    { penalizedAmount: number; penaltyCost: number; reason: string }
  >;
};

/**
 * Per account: `penalized = max(0, withdrawn − penaltyFreeAmount)` —
 * whatever was actually drawn beyond the account's own penalty-free
 * capacity this year. Under the default `avoidPenalizedWithdrawals: true`
 * (see `withdrawal-routing.ts`'s `routeForMode`), the router already
 * excludes penalty-exposed money from the routed total, so `penalized`
 * should be 0 for every account in the overwhelmingly common case — this
 * function does not know or care why a penalized dollar was withdrawn (the
 * lever being off, or a future exception), it only prices whatever was.
 */
export function computeEarlyWithdrawalPenalty(input: {
  exposure: EligibilityRecord;
  withdrawnByKey: Map<string, number>;
}): EarlyWithdrawalPenalty {
  const { exposure, withdrawnByKey } = input;
  const byKey = new Map<
    string,
    { penalizedAmount: number; penaltyCost: number; reason: string }
  >();
  let penaltyCost = 0;
  let penalizedAmount = 0;

  for (const [key, acctExposure] of exposure.byKey) {
    const withdrawn = withdrawnByKey.get(key) ?? 0;
    if (withdrawn <= 0) continue;
    const penalized = roundToCents(
      Math.max(0, withdrawn - acctExposure.penaltyFreeAmount),
    );
    if (penalized <= 0) continue;
    const rate = isHsaCategory(acctExposure.category)
      ? HSA_NON_MEDICAL_PENALTY_RATE
      : EARLY_WITHDRAWAL_PENALTY_RATE;
    const cost = roundToCents(penalized * rate);
    byKey.set(key, {
      penalizedAmount: penalized,
      penaltyCost: cost,
      reason: acctExposure.reason,
    });
    penalizedAmount += penalized;
    penaltyCost += cost;
  }

  return {
    penaltyCost: roundToCents(penaltyCost),
    penalizedAmount: roundToCents(penalizedAmount),
    byKey,
  };
}
