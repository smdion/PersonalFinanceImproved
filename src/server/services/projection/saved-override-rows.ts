/** A saved "Changes by year" row as this version reads it: each account type
 *  (or parent category) it doesn't know dropped, the drops kept for notes. */
import {
  isKnownCategory,
  PARENT_CATEGORY_VALUES,
} from "@/lib/config/account-types";
import {
  knownCategoryList,
  knownCategoryRecord,
  unknownCategoryNote,
  type UnknownTargetLumpSum,
} from "@/lib/pure/accounts/tax-buckets/unknown-type-rows";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Each kind's per-category fields: lists and records of account categories. */
export const CATEGORY_FIELDS = {
  accumulation: ["accountOrder", "accountSplits", "taxSplits", "accountCaps"],
  decumulation: [
    "withdrawalOrder",
    "withdrawalSplits",
    "withdrawalAccountCaps",
    "withdrawalTaxPreference",
  ],
} as const;

/** What `withKnownCategories` drops: a note per category left out of a
 *  row's fields, and each lump sum left out (`unknownLumpSumTargetNotes`). */
export type CategoryDrops = {
  notes: string[];
  lumpSums: UnknownTargetLumpSum[];
};

/** A saved row with each unknown account type dropped from its fields (a list
 *  emptied is removed: the row sets none) and each lump sum to one (or to a
 *  parent category it doesn't know) left out, into `drops` (FALLBACKS). */
export function withKnownCategories(
  row: unknown,
  fields: readonly string[],
  drops: CategoryDrops,
): unknown {
  if (!isRecord(row)) return row;
  const year = String(row.year);
  const kept: Record<string, unknown> = { ...row };
  for (const field of fields) {
    const value = row[field];
    const read = Array.isArray(value)
      ? knownCategoryList(value)
      : isRecord(value)
        ? knownCategoryRecord(value)
        : null;
    if (read === null || read.unknown.length === 0) continue;
    if (Array.isArray(read.known) && read.known.length === 0)
      delete kept[field];
    else kept[field] = read.known;
    for (const category of read.unknown)
      drops.notes.push(unknownCategoryNote(category, { changesByYear: year }));
  }
  if (Array.isArray(row.lumpSums))
    kept.lumpSums = row.lumpSums.filter((lumpSum: unknown) => {
      if (!isRecord(lumpSum)) return true;
      const { targetAccount, targetParentCategory: parent, amount } = lumpSum;
      if (typeof targetAccount === "string" && !isKnownCategory(targetAccount))
        drops.lumpSums.push({
          year,
          target: "accountType",
          category: targetAccount,
          amount,
        });
      else if (
        typeof parent === "string" &&
        !PARENT_CATEGORY_VALUES.some((known) => known === parent)
      )
        drops.lumpSums.push({
          year,
          target: "parentCategory",
          category: parent,
          amount,
        });
      else return true;
      return false;
    });
  return kept;
}
