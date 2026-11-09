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
  /** Owner of the targeted account, since two members can share an account name.
   *  When set, the engine matches (name, ownerName) before name alone, like
   *  `ContributionSpec.ownerName`. Undefined ⇒ name-only match. */
  targetOwnerName?: string;
  /** Whose money it is when no account is named: "Portfolio" for the Brokerage
   *  page's lump sums, otherwise retirement money. Picks Portfolio- or
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
