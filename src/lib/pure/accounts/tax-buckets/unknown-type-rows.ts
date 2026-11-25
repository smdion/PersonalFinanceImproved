/** Money saved under an account type this version doesn't know: the
 *  projection and Tax Buckets leave it out, and say so. */
import {
  projectedRowsByType,
  type TaxBucketSnapshotAccount,
} from "@/lib/pure/accounts/tax-buckets/tax-buckets";
import type { StoredAccountType } from "@/lib/config/account-types.types";
import {
  isKnownCategory,
  type AccountCategory,
} from "@/lib/config/account-types";
import { accountDisplayName } from "@/lib/utils/account-name";

/** Whole dollars, as the engine's own warnings show them. */
const dollars = (amount: number) =>
  `$${Math.round(amount).toLocaleString("en-US")}`;

/** A projected snapshot row of an unknown account type, as stored. */
export type UnknownTypeRow = {
  portfolioAccountId: number;
  name: string;
  accountType: StoredAccountType;
  amount: number;
};

/** Each projected row whose category this version doesn't know
 *  (`projectedRowsByType`), in the rows' order. */
export function unknownTypeRows(
  rows: readonly TaxBucketSnapshotAccount[],
  people: readonly { id: number; name: string }[],
): UnknownTypeRow[] {
  return projectedRowsByType(rows).unknown.map(({ row, category }) => ({
    portfolioAccountId: row.portfolioAccountId,
    name: accountDisplayName(
      row,
      people.find((p) => p.id === row.ownerPersonId)?.name,
    ),
    accountType: category,
    amount: row.amount,
  }));
}

/** The note for one, naming its amount (whole dollars, formatted as the
 *  engine's own warnings are: it is cached with them, unmasked). */
export function unknownTypeNote(fact: UnknownTypeRow): string {
  return `${fact.name} is saved as account type "${fact.accountType}", which this version doesn't know, so the projection and Tax Buckets leave out its ${dollars(fact.amount)}. Update Ledgr or change its account type.`;
}

/** Contribution accounts split by whether this version knows their stored
 *  type: the projection reads only the `known` ones. */
export function contributionsByType<
  R extends { accountType: StoredAccountType },
>(
  rows: readonly R[],
): { known: (R & { accountType: AccountCategory })[]; unknown: R[] } {
  const known: (R & { accountType: AccountCategory })[] = [];
  const unknown: R[] = [];
  for (const row of rows) {
    const { accountType } = row;
    if (isKnownCategory(accountType)) known.push({ ...row, accountType });
    else unknown.push(row);
  }
  return { known, unknown };
}

/** The note for a contribution account `contributionsByType` leaves out:
 *  one text wherever it shows (the projection, Contributions, Paycheck), so
 *  a page showing two of them names it once. */
export function unknownTypeContributionNote(
  name: string,
  accountType: StoredAccountType,
): string {
  return `${name} is saved as account type "${accountType}", which this version doesn't know, so its contributions are left out. Update Ledgr to a version that knows this type.`;
}

/** A saved list of account categories (a withdrawal order), each entry this
 *  version doesn't know left out and named in `unknown`, in its order. */
export function knownCategoryList(stored: readonly unknown[]): {
  known: AccountCategory[];
  unknown: string[];
} {
  const known: AccountCategory[] = [];
  const unknown: string[] = [];
  for (const entry of stored) {
    if (typeof entry === "string" && isKnownCategory(entry)) known.push(entry);
    else unknown.push(String(entry));
  }
  return { known, unknown };
}

/** A saved per-category record (splits, caps, a tax preference), each key
 *  this version doesn't know left out and named in `unknown`. */
export function knownCategoryRecord<V>(stored: Readonly<Record<string, V>>): {
  known: Partial<Record<AccountCategory, V>>;
  unknown: string[];
} {
  const known: Partial<Record<AccountCategory, V>> = {};
  const unknown: string[] = [];
  for (const [key, value] of Object.entries(stored)) {
    if (isKnownCategory(key)) known[key] = value;
    else unknown.push(key);
  }
  return { known, unknown };
}

/** A saved setting a category can be left out of: retirement_settings'
 *  withdrawal order or splits, or a year's Changes by year row. */
export type SavedCategorySetting =
  "withdrawalOrder" | "withdrawalSplits" | { changesByYear: string };

/** A year's Changes by year row, as the notes name it. */
const changesByYear = (year: string) => `Changes by year for ${year}`;

const SAVED_ROUTING_NAMES = {
  withdrawalOrder: "the saved withdrawal order",
  withdrawalSplits: "the saved withdrawal splits",
} as const;

/** The note for a category `knownCategoryList` or `knownCategoryRecord`
 *  leaves out of a saved setting. */
export function unknownCategoryNote(
  category: string,
  setting: SavedCategorySetting,
): string {
  const name =
    typeof setting === "string"
      ? SAVED_ROUTING_NAMES[setting]
      : changesByYear(setting.changesByYear);
  return `Account type "${category}", which this version doesn't know, is left out of ${name}. Update Ledgr or change that setting.`;
}

/** What a left-out lump sum's unknown target is, as its note names it. */
const TARGET_NAMES = {
  accountType: "account type",
  parentCategory: "parent category",
} as const;

/** A saved lump sum the projection leaves out: its row's year, its target
 *  this version doesn't know (an account type or a parent category), and
 *  its amount as stored. */
export type UnknownTargetLumpSum = {
  year: string;
  target: keyof typeof TARGET_NAMES;
  category: StoredAccountType;
  amount: unknown;
};

/** Lump sums grouped by year and target, in first-seen order: the target
 *  worded, how many, and their total in whole dollars (null when one of them
 *  stores no number). */
function lumpSumGroups(lumpSums: readonly UnknownTargetLumpSum[]) {
  const groups = new Map<
    string,
    Omit<UnknownTargetLumpSum, "amount"> & { amounts: unknown[] }
  >();
  for (const { year, target, category, amount } of lumpSums) {
    const key = JSON.stringify([year, target, category]);
    const group = groups.get(key);
    if (group) group.amounts.push(amount);
    else groups.set(key, { year, target, category, amounts: [amount] });
  }
  return [...groups.values()].map(({ year, target, category, amounts }) => {
    const sum = amounts.every(
      (a): a is number => typeof a === "number" && Number.isFinite(a),
    )
      ? amounts.reduce((total, a) => total + a, 0)
      : null;
    return {
      year,
      target: `${TARGET_NAMES[target]} "${category}", which this version doesn't know`,
      count: amounts.length,
      total:
        sum === null ? null : `${sum < 0 ? "-" : ""}${dollars(Math.abs(sum))}`,
    };
  });
}

/** One note per year and target for the lump sums left out, in first-seen
 *  order, with their amount (summed, with the count, for more than one); no
 *  amount when one of them stores no number. */
export function unknownLumpSumTargetNotes(
  lumpSums: readonly UnknownTargetLumpSum[],
): string[] {
  return lumpSumGroups(lumpSums).map(({ year, target, count, total }) => {
    const where = `in ${changesByYear(year)}`;
    if (count === 1)
      return `A lump sum ${total ? `of ${total} ` : ""}${where} goes to ${target}, so the projection leaves it out. Update Ledgr or change that lump sum.`;
    return `${count} lump sums ${total ? `totalling ${total} ` : ""}${where} go to ${target}, so the projection leaves them out. Update Ledgr or change those lump sums.`;
  });
}

/** The notes for a deleted Changes by year row's entries for types this
 *  version doesn't know: each account type its fields named, then its lump
 *  sums (`unknownLumpSumTargetNotes`' groups). */
export function deletedRowUnknownTypeNotes(
  year: string,
  categories: readonly StoredAccountType[],
  lumpSums: readonly UnknownTargetLumpSum[],
): string[] {
  const deleting = `Deleting ${changesByYear(year)} also deleted`;
  return [
    ...[...new Set(categories)].map(
      (category) =>
        `${deleting} what it set for account type "${category}", which this version doesn't know.`,
    ),
    ...lumpSumGroups(lumpSums).map(({ target, count, total }) =>
      count === 1
        ? `${deleting} its lump sum ${total ? `of ${total} ` : ""}to ${target}.`
        : `${deleting} its ${count} lump sums ${total ? `totalling ${total} ` : ""}to ${target}.`,
    ),
  ];
}

/** The notes for the Brokerage page's planned events to an account type this
 *  version doesn't know, grouped as lump sums are: the page leaves them out,
 *  and a save keeps them. */
export function unknownTargetEventNotes(
  events: readonly Omit<UnknownTargetLumpSum, "target">[],
): string[] {
  const asLumpSums = events.map((e) => ({
    ...e,
    target: "accountType" as const,
  }));
  return lumpSumGroups(asLumpSums).map(({ year, target, count, total }) =>
    count === 1
      ? `A planned event ${total ? `of ${total} ` : ""}in ${year} goes to ${target}, so this page leaves it out and keeps it saved. Update Ledgr to see or change it.`
      : `${count} planned events ${total ? `totalling ${total} ` : ""}in ${year} go to ${target}, so this page leaves them out and keeps them saved. Update Ledgr to see or change them.`,
  );
}
