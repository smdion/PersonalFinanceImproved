/** A lump sum's target as its writers save it: the names and the ids tag 0023
 *  writes beside them, so a re-save keeps the ids and a replay of the tag
 *  finds nothing to convert (`LumpSum.targetPerformanceAccountId`). */
import type { IndividualAccountYearBalance } from "@/lib/pure/accounts/account-balances.types";

export type LumpSumTargetIds = {
  /** The named account's performance account (null: no single account) and
   *  owner (null: joint). Absent on a lump sum saved before tag 0023. */
  targetPerformanceAccountId?: number | null;
  targetOwnerPersonId?: number | null;
};

/** What `pickedTarget` reads of a lump-sum picker option. */
export type PickedAccount = {
  name: string;
  /** Owner of this account — shown + stored so two household
   *  members' identically-named accounts don't collide when targeted. */
  ownerName?: string;
  performanceAccountId?: number;
  ownerPersonId?: number;
};

/** The picker's option for one of the projection's accounts. The Brokerage
 *  page's picker (`withOwner` false) shows no owner name. */
export function accountOption(
  ia: IndividualAccountYearBalance,
  withOwner = true,
) {
  return {
    name: ia.name,
    category: ia.category,
    taxType: ia.taxType,
    ...(withOwner ? { ownerName: ia.ownerName } : {}),
    performanceAccountId: ia.performanceAccountId,
    ownerPersonId: ia.ownerPersonId,
  };
}

/** The target a new lump sum saves: the picked names and, when an account is
 *  named, the ids of the one part they pick (id and owner, null when joint),
 *  else a null id alone, as tag 0023 writes for a name that isn't unique. */
export function pickedTarget(
  accounts: readonly PickedAccount[],
  picked: { targetAccountName: string; targetOwnerName: string },
): { targetAccountName: string; targetOwnerName: string } & LumpSumTargetIds {
  const { targetAccountName, targetOwnerName } = picked;
  if (!targetAccountName) return { targetAccountName, targetOwnerName };
  const parts = new Map(
    accounts
      .filter(
        (a) =>
          a.name === targetAccountName &&
          (a.ownerName ?? "") === targetOwnerName,
      )
      .map((a) => [`${a.performanceAccountId}|${a.ownerPersonId}`, a]),
  );
  const [only] = parts.values();
  if (parts.size !== 1 || only?.performanceAccountId === undefined)
    return {
      targetAccountName,
      targetOwnerName,
      targetPerformanceAccountId: null,
    };
  return {
    targetAccountName,
    targetOwnerName,
    targetPerformanceAccountId: only.performanceAccountId,
    targetOwnerPersonId: only.ownerPersonId ?? null,
  };
}

/** A lump sum's account name and ids, each only when set, for a writer that
 *  rebuilds it from its fields (its owner name is the caller's). */
export function lumpSumTarget(
  ls: LumpSumTargetIds & { targetAccountName?: string },
) {
  return {
    ...(ls.targetAccountName
      ? { targetAccountName: ls.targetAccountName }
      : {}),
    ...(ls.targetPerformanceAccountId !== undefined
      ? { targetPerformanceAccountId: ls.targetPerformanceAccountId }
      : {}),
    ...(ls.targetOwnerPersonId !== undefined
      ? { targetOwnerPersonId: ls.targetOwnerPersonId }
      : {}),
  };
}
