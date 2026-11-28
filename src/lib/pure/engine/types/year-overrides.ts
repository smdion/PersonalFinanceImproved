/** Inputs the projection applies in one calendar year: lump sums, planned
 *  brokerage withdrawals and salary or budget overrides. */

import type { AccountCategory } from "@/lib/config/account-types";
import type { RothSplitSide } from "@/lib/config/tax-treatment-buckets";

/**
 * A one-time dollar amount added in a specific year (above $0: lumpSumSchema).
 * NOT sticky-forward — only applied in the exact override year.
 * Bypasses IRS contribution limits (models rollovers, inheritances, etc.).
 */
export type LumpSum = {
  amount: number;
  targetAccount: AccountCategory;
  taxType?: RothSplitSide;
  /** Specific individual account name (e.g., "Long Term Brokerage (Vanguard)").
   *  Matched to its part only when no account id is stored, once per run
   *  (lump-sum-targets.ts); the year logic never reads it. */
  targetAccountName?: string;
  /** Owner of the targeted account, since two members can share an account name.
   *  When set, the name's part of this owner is picked before the others.
   *  Undefined ⇒ name-only match. */
  targetOwnerName?: string;
  /** The named account's performance account and owner (null: joint): the
   *  account, read before the names. A null id (no single account matched)
   *  or an absent one leaves it to the names. */
  targetPerformanceAccountId?: number | null;
  targetOwnerPersonId?: number | null;
  /** Whose money it is when no account is named: "Portfolio" for the Brokerage
   *  page's lump sums, otherwise retirement money. Picks Portfolio- or
   *  Retirement-parented accounts first. */
  targetParentCategory?: "Retirement" | "Portfolio";
  label?: string;
};

/**
 * A one-time withdrawal from the Portfolio brokerages in a working year (the
 * Brokerage page's planned events, above $0). It is drawn as a brokerage goal
 * is, before the year's goals.
 */
export type PlannedBrokerageWithdrawal = {
  id: string;
  year: number;
  amount: number;
  label?: string;
};

/** One draw from the Portfolio brokerages: the amount drawn (at most what
 *  they hold), the basis and gain it sold, and the gain's tax. */
export type BrokerageDraw = {
  amount: number;
  basisPortion: number;
  gainsPortion: number;
  taxCost: number;
};
/** A goal's draw and a planned withdrawal's, as the year row reports them. */
export type BrokerageGoalDraw = BrokerageDraw & {
  goalId: number;
  name: string;
};
export type PlannedBrokerageDraw = BrokerageDraw & {
  id: string;
  label?: string;
  /** What the withdrawal asked for; `amount` is below it when the
   *  brokerages held less. */
  requested: number;
};

/** Override salary or budget at a specific calendar year in the projection. */
export type RetirementYearOverride = {
  year: number;
  value: number;
  notes?: string;
};

/** Why a lump sum picks no single part: its stored account has no part of
 *  its tax type and owner, or its name (with no id) matches none or several. */
export type UnresolvedLumpSumReason =
  "accountGone" | "nameMatchesNone" | "nameMatchesSeveral";

/** A lump sum shared by balance within its parent because it picks no
 *  single part (J15): the fact a view words (`resolveLumpSums`). */
export type UnresolvedLumpSum = {
  year: number;
  category: AccountCategory;
  amount: number;
  reason: UnresolvedLumpSumReason;
};
