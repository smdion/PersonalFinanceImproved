/** Which early-access gate a locked account waits on: 59½ (IRA), Rule of
 *  55 or 59½ (employer plan; the Rule of 55 marked unavailable for
 *  forecasting is its own case), 65 (HSA non-medical draws). */
export type EligibilityLockedGate =
  "age_59_half" | "rule_of_55_or_age" | "rule_of_55_unavailable" | "hsa_age_65";

/** Why an account's dollars are or aren't penalty-free this year, as
 *  `computeWithdrawalEligibility` (lib/pure/accounts/eligibility.ts) found
 *  it; `describeEligibility` (eligibility-labels.ts) words it. */
export type EligibilityReason =
  /** No owner with a birth year (a joint account): no age rule applies. */
  | { kind: "no_owner" }
  /** No age or employer rule (brokerage). */
  | { kind: "always_available" }
  | { kind: "age_reached"; gate: "age_59_half" | "hsa_age_65" }
  | { kind: "rule_of_55"; separationYear?: number }
  /** A Roth IRA before 59½ whose whole balance is basis. */
  | { kind: "basis_remaining"; basis: number }
  /** A Roth IRA before 59½: basis penalty-free, growth locked. */
  | { kind: "basis_partial"; basis: number; growthLocked: number }
  /** A Roth IRA before 59½ with no basis left. */
  | { kind: "no_basis" }
  | { kind: "locked"; gate: EligibilityLockedGate; currentAge: number };
