// Words for withdrawal eligibility (EligibilityReason, lib/pure/accounts).
import type {
  EligibilityReason,
  EligibilityLockedGate,
} from "@/lib/config/eligibility-reason";
import { formatCurrency } from "@/lib/utils/format";

/** What a locked account waits for, by gate. */
const LOCKED_UNTIL: Record<EligibilityLockedGate, string> = {
  age_59_half: "Locked until age 59½",
  rule_of_55_or_age: "Locked until Rule of 55 or age 59½",
  rule_of_55_unavailable:
    "Locked until age 59½ — Rule of 55 marked unavailable for forecasting",
  hsa_age_65: "Locked until age 65 — non-medical withdrawal penalty",
};

/** The words for an account's withdrawal eligibility this year. Not in
 *  display-labels.ts: formatCurrency imports account-types, which imports
 *  display-labels. */
export function describeEligibility(reason: EligibilityReason): string {
  switch (reason.kind) {
    case "no_owner":
      return "No individual eligibility rule (joint account)";
    case "always_available":
      return "Always accessible — no age or employer restriction";
    case "age_reached":
      return reason.gate === "hsa_age_65"
        ? "Eligible — age 65 or older"
        : "Eligible — age 59½ or older";
    case "rule_of_55":
      return reason.separationYear != null
        ? `Eligible — Rule of 55 met (separated ${reason.separationYear})`
        : "Eligible — Rule of 55 met";
    case "basis_remaining":
      return `Eligible — ${formatCurrency(reason.basis)} basis remaining, always penalty-free`;
    case "basis_partial":
      return `Partially eligible — ${formatCurrency(reason.basis)} basis penalty-free, ${formatCurrency(reason.growthLocked)} growth locked until 59½`;
    case "no_basis":
      return "Locked until age 59½ — no basis remaining";
    case "locked":
      return `${LOCKED_UNTIL[reason.gate]} (currently ${reason.currentAge})`;
  }
}
