/** Inputs the projection applies in one calendar year: lump sums and
 *  salary or budget overrides. */

import type { AccountCategory } from "@/lib/config/account-types";

/**
 * A one-time dollar-amount injection or withdrawal in a specific year.
 * NOT sticky-forward — only applied in the exact override year.
 * Bypasses IRS contribution limits (models rollovers, inheritances, etc.).
 */
export type LumpSum = {
  amount: number;
  targetAccount: AccountCategory;
  taxType?: "traditional" | "roth";
  /** Specific individual account name (e.g., "Long Term Brokerage (Vanguard)").
   *  When set, the engine adds the lump sum to this exact account in indBalance. */
  targetAccountName?: string;
  /** Owner name of the targeted individual account — two
   *  household members can independently choose the same account name (e.g.
   *  both "Long Term Brokerage"), and `targetAccountName` alone can't tell
   *  them apart. When set, the engine matches on (name, ownerName) before
   *  falling back to name alone, mirroring how `ContributionSpec.ownerName`
   *  already disambiguates the same collision for ongoing contributions
   *  (`individual-accounts/contributions.ts`'s `buildSpecToAccountMapping`).
   *  Undefined ⇒ name-only match, unchanged behavior for every lump sum
   *  saved before this field existed. */
  targetOwnerName?: string;
  /** Whose money it is when no account is named: "Portfolio" for the
   *  Brokerage page's lump sums (Portfolio savings), otherwise retirement
   *  money (the retirement projection's own). Picks Portfolio- or
   *  Retirement-parented accounts first. */
  targetParentCategory?: "Retirement" | "Portfolio";
  label?: string;
};

/** Override salary or budget at a specific calendar year in the projection. */
export type RetirementYearOverride = {
  year: number;
  value: number;
  notes?: string;
};
