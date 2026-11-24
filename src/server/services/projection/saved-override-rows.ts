/** A saved "Changes by year" or Brokerage set as this version reads it (each
 *  account type it doesn't know dropped and named) and saves it (kept). */
import {
  isKnownCategory,
  PARENT_CATEGORY_VALUES,
} from "@/lib/config/account-types";
import {
  deletedRowUnknownTypeNotes,
  knownCategoryList,
  knownCategoryRecord,
  unknownCategoryNote,
  unknownLumpSumTargetNotes,
  unknownTargetEventNotes,
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
      const unknown = isRecord(lumpSum) ? unknownLumpSumTarget(lumpSum) : null;
      if (!unknown) return true;
      drops.lumpSums.push({ year, ...unknown });
      return false;
    });
  return kept;
}

/** A saved lump sum's target this version doesn't know (its account type, or
 *  else its parent category) with its amount as stored; null when known. */
function unknownLumpSumTarget(
  lumpSum: Record<string, unknown>,
): Omit<UnknownTargetLumpSum, "year"> | null {
  const { targetAccount, targetParentCategory: parent, amount } = lumpSum;
  if (isUnknownTarget(targetAccount))
    return { target: "accountType", category: targetAccount, amount };
  if (
    typeof parent === "string" &&
    !PARENT_CATEGORY_VALUES.some((known) => known === parent)
  )
    return { target: "parentCategory", category: parent, amount };
  return null;
}

/** A stored lump-sum or event target naming an account type this version
 *  doesn't know (another value is left for its shape's check). */
const isUnknownTarget = (target: unknown): target is string =>
  typeof target === "string" && !isKnownCategory(target);

/** A saved set as an editor reads or saves it, with the notes for what it
 *  leaves out of the stored set. */
export type EditableSavedSet = {
  rows: Record<string, unknown>[];
  unknownTypeNotes: string[];
};

type SavedSetKind = "accumulation" | "decumulation" | "brokerage";

/** A stored set's rows: its records (another stored value has none). */
const storedRows = (stored: unknown) =>
  Array.isArray(stored) ? stored.filter(isRecord) : [];

/** A stored event amount ("5000") as a number for its note, when it is one. */
const eventAmount = (amount: unknown) =>
  typeof amount === "string" && amount.trim() !== "" && isFinite(+amount)
    ? +amount
    : amount;

/** A saved set as the Changes by year editor and the Brokerage page read it:
 *  each unknown account type dropped as the projection drops it (an event to
 *  one left out), named in the notes. `withStoredUnknownTypes` keeps them. */
export function editableSavedSet(
  kind: SavedSetKind,
  stored: unknown,
): EditableSavedSet {
  const rows = storedRows(stored);
  if (kind === "accumulation" || kind === "decumulation") {
    const drops: CategoryDrops = { notes: [], lumpSums: [] };
    return {
      rows: rows
        .map((row) => withKnownCategories(row, CATEGORY_FIELDS[kind], drops))
        .filter(isRecord),
      unknownTypeNotes: [
        ...new Set(drops.notes),
        ...unknownLumpSumTargetNotes(drops.lumpSums),
      ],
    };
  }
  const left: Omit<UnknownTargetLumpSum, "target">[] = [];
  const kept = rows.filter(({ year, targetAccount, amount }) => {
    if (!isUnknownTarget(targetAccount)) return true;
    left.push({
      year: String(year),
      category: targetAccount,
      amount: eventAmount(amount),
    });
    return false;
  });
  return { rows: kept, unknownTypeNotes: unknownTargetEventNotes(left) };
}

/** A stored row's entries for types this version doesn't know: each list
 *  field's entries at their places, each record field's keys, its lump sums. */
function unknownPart(row: Record<string, unknown>, fields: readonly string[]) {
  const lists = new Map<string, { index: number; entry: unknown }[]>();
  const records = new Map<string, [string, unknown][]>();
  const categories: string[] = [];
  for (const field of fields) {
    const value = row[field];
    if (Array.isArray(value)) {
      const entries = value.flatMap((entry: unknown, index) =>
        typeof entry === "string" && isKnownCategory(entry)
          ? []
          : [{ index, entry }],
      );
      if (entries.length > 0) lists.set(field, entries);
      categories.push(...entries.map(({ entry }) => String(entry)));
    } else if (isRecord(value)) {
      const entries = Object.entries(value).filter(
        ([key]) => !isKnownCategory(key),
      );
      if (entries.length > 0) records.set(field, entries);
      categories.push(...entries.map(([key]) => key));
    }
  }
  const lumpSums: Record<string, unknown>[] = [];
  const facts: UnknownTargetLumpSum[] = [];
  for (const lumpSum of storedRows(row.lumpSums)) {
    const unknown = unknownLumpSumTarget(lumpSum);
    if (!unknown) continue;
    lumpSums.push(lumpSum);
    facts.push({ year: String(row.year), ...unknown });
  }
  if (categories.length === 0 && lumpSums.length === 0) return null;
  return { lists, records, categories, lumpSums, facts };
}

/** `part` put back into `row`: list entries at their stored places, record
 *  keys beside the row's own, lump sums after its own. */
function mergeInto(
  row: Record<string, unknown>,
  part: NonNullable<ReturnType<typeof unknownPart>>,
) {
  for (const [field, entries] of part.lists) {
    const current = row[field];
    const list: unknown[] = Array.isArray(current) ? [...current] : [];
    for (const { index, entry } of entries)
      list.splice(Math.min(index, list.length), 0, entry);
    row[field] = list;
  }
  for (const [field, entries] of part.records) {
    const current = row[field];
    row[field] = {
      ...(isRecord(current) ? current : {}),
      ...Object.fromEntries(entries),
    };
  }
  if (part.lumpSums.length > 0) {
    const current = row.lumpSums;
    row.lumpSums = [
      ...(Array.isArray(current) ? current : []),
      ...part.lumpSums,
    ];
  }
}

/** The set to store for an editor's `saved` set: each stored entry for an
 *  unknown type merged back into its year's row, each stored event to one
 *  kept; a stored row whose year `saved` lacks loses them, named in notes. */
export function withStoredUnknownTypes(
  kind: SavedSetKind,
  saved: readonly Record<string, unknown>[],
  stored: unknown,
): EditableSavedSet {
  if (kind === "accumulation" || kind === "decumulation")
    return withStoredRowEntries(CATEGORY_FIELDS[kind], saved, stored);
  return {
    rows: [
      ...saved,
      ...storedRows(stored).filter((e) => isUnknownTarget(e.targetAccount)),
    ],
    unknownTypeNotes: [],
  };
}

/** `withStoredUnknownTypes` for a Changes by year set. */
function withStoredRowEntries(
  fields: readonly string[],
  saved: readonly Record<string, unknown>[],
  stored: unknown,
): EditableSavedSet {
  const rows = saved.map((row) => ({ ...row }));
  const unknownTypeNotes: string[] = [];
  for (const row of storedRows(stored)) {
    const part = unknownPart(row, fields);
    if (!part) continue;
    const year = String(row.year);
    const target = rows.find((r) => String(r.year) === year);
    if (target) mergeInto(target, part);
    else
      unknownTypeNotes.push(
        ...deletedRowUnknownTypeNotes(year, part.categories, part.facts),
      );
  }
  return { rows, unknownTypeNotes };
}
