/** A lump sum's target as its writers save it: the names, the tax side, and
 *  the ids tag 0023 writes beside them, so a re-save keeps the ids and a
 *  replay of the tag finds nothing to convert. */
import type { IndividualAccountYearBalance } from "@/lib/pure/accounts/account-balances.types";
import {
  taxTypeOnSide,
  type RothSplitSide,
} from "@/lib/config/tax-treatment-buckets";

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
  /** The side of a Roth-capable account this part is (`partSide`). */
  side?: RothSplitSide;
};

/** The side whose money lands in a part of this category and tax type;
 *  none for a category without a Roth side. */
function partSide(ia: IndividualAccountYearBalance): RothSplitSide | undefined {
  const roth = taxTypeOnSide(ia.category, "roth");
  const traditional = taxTypeOnSide(ia.category, "traditional");
  if (roth === traditional) return undefined;
  if (ia.taxType === roth) return "roth";
  return ia.taxType === traditional ? "traditional" : undefined;
}

/** The picker's option for one of the projection's accounts. The Brokerage
 *  page's picker (`withOwner` false) shows no owner name. */
export function accountOption(
  ia: IndividualAccountYearBalance,
  withOwner = true,
) {
  return {
    name: ia.name,
    category: ia.category,
    side: partSide(ia),
    ...(withOwner ? { ownerName: ia.ownerName } : {}),
    performanceAccountId: ia.performanceAccountId,
    ownerPersonId: ia.ownerPersonId,
  };
}

/** A new lump sum's target: the picked names; their parts' side when they
 *  share one, else "" (Traditional); the one part's ids (owner null when
 *  joint), else a null id alone, as tag 0023 writes for a name not unique. */
export function pickedTarget(
  accounts: readonly PickedAccount[],
  picked: { targetAccountName: string; targetOwnerName: string },
): {
  targetAccountName: string;
  targetOwnerName: string;
  taxType: RothSplitSide | "";
} & LumpSumTargetIds {
  const { targetAccountName, targetOwnerName } = picked;
  if (!targetAccountName)
    return { targetAccountName, targetOwnerName, taxType: "" };
  const rows = accounts.filter(
    (a) =>
      a.name === targetAccountName && (a.ownerName ?? "") === targetOwnerName,
  );
  const sides = new Set(rows.map((a) => a.side));
  const [side] = sides;
  const taxType = sides.size === 1 && side ? side : "";
  const parts = new Map(
    rows.map((a) => [`${a.performanceAccountId}|${a.ownerPersonId}`, a]),
  );
  const [only] = parts.values();
  if (parts.size !== 1 || only?.performanceAccountId === undefined)
    return {
      targetAccountName,
      targetOwnerName,
      taxType,
      targetPerformanceAccountId: null,
    };
  return {
    targetAccountName,
    targetOwnerName,
    taxType,
    targetPerformanceAccountId: only.performanceAccountId,
    targetOwnerPersonId: only.ownerPersonId ?? null,
  };
}

/** A lump sum's account name, tax side and ids, each only when set, for a
 *  writer that rebuilds it from its fields (its owner name is the caller's). */
export function lumpSumTarget(
  ls: LumpSumTargetIds & {
    targetAccountName?: string;
    taxType?: RothSplitSide | "";
  },
) {
  return {
    ...(ls.taxType ? { taxType: ls.taxType } : {}),
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
