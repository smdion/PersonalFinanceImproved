/** A lump sum's target as its writers save it: the names, the tax side, and
 *  the ids tag 0023 writes beside them, so a re-save keeps the ids and a
 *  replay of the tag finds nothing to convert. */
import type { IndividualAccountYearBalance } from "@/lib/pure/accounts/account-balances.types";
import {
  ROTH_SPLIT_PARTS,
  taxTypeOnSide,
  type RothSplitSide,
} from "@/lib/config/tax-treatment-buckets";
import { TAX_TYPE_LABELS } from "@/lib/config/display-labels";

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

/** What a picker option picks: an account's name and owner, and the side of
 *  the part when the account is held in both tax parts under them. */
export type PickedTarget = {
  targetAccountName: string;
  targetOwnerName: string;
  targetSide?: RothSplitSide | undefined;
};

/** A picker option's key (`<option>` key and value), distinct per option. */
export function choiceKey(picked: PickedTarget): string {
  const named = `${picked.targetAccountName}::${picked.targetOwnerName}`;
  return picked.targetSide ? `${named}::${picked.targetSide}` : named;
}

/** The lump-sum picker's options. An account held in both tax parts under one
 *  name and owner shows one option per part, each labelled with its side. */
export function pickerChoices<A extends PickedAccount>(accounts: readonly A[]) {
  const named = (a: PickedAccount) => `${a.name}::${a.ownerName ?? ""}`;
  return accounts.map((account) => {
    const split = accounts.some(
      (b) => named(b) === named(account) && b.side !== account.side,
    );
    const side = split ? account.side : undefined;
    const picked: PickedTarget = {
      targetAccountName: account.name,
      targetOwnerName: account.ownerName ?? "",
      targetSide: side,
    };
    const owner = account.ownerName ? ` (${account.ownerName})` : "";
    const part = side ? ` (${TAX_TYPE_LABELS[ROTH_SPLIT_PARTS[side]]})` : "";
    return {
      account,
      picked,
      key: choiceKey(picked),
      label: `${account.name}${owner}${part}`,
    };
  });
}

/** A new lump sum's target: the picked names; the side the picked parts
 *  share, else "" (Traditional); the one part's ids (owner null when joint),
 *  else a null id alone, as tag 0023 writes for a name not unique. */
export function pickedTarget(
  accounts: readonly PickedAccount[],
  picked: PickedTarget,
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
      a.name === targetAccountName &&
      (a.ownerName ?? "") === targetOwnerName &&
      (!picked.targetSide || a.side === picked.targetSide),
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
