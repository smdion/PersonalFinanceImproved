/**
 * Early-withdrawal penalty cost: prices the dollars drawn beyond each
 * account's penalty-free amount in the eligibility record, at 10% (IRC
 * §72(t)) or the type's non-medical penalty (HSA's 20%, IRC §223(f)(4)).
 */
import type { EligibilityRecord } from "@/lib/pure/accounts/eligibility";
import type { EligibilityReason } from "@/lib/config/eligibility-reason";
import { nonMedicalPenaltyRate } from "@/lib/config/account-types";
import { EARLY_WITHDRAWAL_PENALTY_RATE } from "@/lib/constants";
import { roundToCents } from "@/lib/utils/math";

type EarlyWithdrawalPenalty = {
  /** Sum of every account's penalty cost this year. */
  penaltyCost: number;
  /** Sum of every account's penalized (penalty-exposed and actually
   *  withdrawn) dollars this year. */
  penalizedAmount: number;
  byKey: Map<
    string,
    { penalizedAmount: number; penaltyCost: number; reason: EligibilityReason }
  >;
};

/**
 * Per account: `penalized = max(0, withdrawn − penaltyFreeAmount)`. Normally 0, since the
 * router excludes penalty-exposed money by default; this only prices what was drawn.
 */
export function computeEarlyWithdrawalPenalty(input: {
  exposure: EligibilityRecord;
  withdrawnByKey: Map<string, number>;
}): EarlyWithdrawalPenalty {
  const { exposure, withdrawnByKey } = input;
  const byKey = new Map<
    string,
    { penalizedAmount: number; penaltyCost: number; reason: EligibilityReason }
  >();
  let penaltyCost = 0;
  let penalizedAmount = 0;

  for (const [key, accountExposure] of exposure.byKey) {
    const withdrawn = withdrawnByKey.get(key) ?? 0;
    if (withdrawn <= 0) continue;
    const penalized = roundToCents(
      Math.max(0, withdrawn - accountExposure.penaltyFreeAmount),
    );
    if (penalized <= 0) continue;
    const rate =
      nonMedicalPenaltyRate(accountExposure.category) ??
      EARLY_WITHDRAWAL_PENALTY_RATE;
    const cost = roundToCents(penalized * rate);
    byKey.set(key, {
      penalizedAmount: penalized,
      penaltyCost: cost,
      reason: accountExposure.reason,
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
