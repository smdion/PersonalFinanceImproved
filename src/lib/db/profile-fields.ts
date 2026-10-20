/**
 * Which edit fields a Contribution Profile holds, read from its schemas —
 * the Paycheck page's write routing (resolvePaycheckEditTarget) uses this
 * instead of a hand-kept list.
 */
import {
  contribAccountActiveFieldsPatchSchema,
  deductionActiveFieldsSchema,
} from "@/lib/db/json-schemas";
import type { PaycheckFieldKind } from "@/lib/pure/paycheck-edit-target";

/** A contribution-account field is a profile field when a Contribution
 *  Profile can hold it; everything else is shared setup. */
export function contributionAccountFieldKind(field: string): PaycheckFieldKind {
  return field in contribAccountActiveFieldsPatchSchema.shape
    ? "contribution"
    : "setup";
}

/** Same rule for a deduction: only its amount lives in a profile. */
export function deductionFieldKind(field: string): PaycheckFieldKind {
  return field in deductionActiveFieldsSchema.shape ? "contribution" : "setup";
}
