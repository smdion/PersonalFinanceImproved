// The zero AccountBalance for a balance structure, which the account-type
// config builds its empty balances from. The accessors and mutators are in
// lib/pure/accounts/account-balance.ts.

import { assertNever } from "@/lib/utils/assert-never";
import type { AccountBalance, BalanceStructure } from "./account-types.types";

/** Create a zero-initialized AccountBalance for the given balance structure. */
export function zeroBalanceForStructure(
  structure: BalanceStructure,
): AccountBalance {
  switch (structure) {
    case "roth_traditional":
      return { structure: "roth_traditional", traditional: 0, roth: 0 };
    case "single_bucket":
      return { structure: "single_bucket", balance: 0 };
    case "basis_tracking":
      return { structure: "basis_tracking", balance: 0, basis: 0 };
    default:
      return assertNever(structure);
  }
}
