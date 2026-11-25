/** A saved "Changes by year" or Brokerage set as this version reads it (each
 *  account type it doesn't know dropped and named) and saves it (kept). */
import type { z } from "zod/v4";
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

/** A stored value as a note quotes it: its JSON, cut at 40 characters. */
const quoted = (value: unknown) => {
  // String(): a value JSON has no form for stringifies to undefined.
  const text = String(JSON.stringify(value));
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
};

/** The notes for a part of a saved row this version can't read. */
const refusedNotes = {
  field: (year: string, field: string, value: unknown) =>
    `Changes by year for ${year} saves its ${field.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`)} as ${quoted(value)}, which this version doesn't read, so the projection leaves that setting out. Update Ledgr or change that year.`,
  lumpSum: (year: string, amount: unknown) => {
    const n = typeof amount === "string" ? Number(amount) : amount;
    const of =
      typeof n === "number" && Number.isFinite(n) && amount !== ""
        ? `of $${Math.round(n).toLocaleString("en-US")} `
        : "";
    return `A lump sum ${of}in Changes by year for ${year} isn't saved in a shape this version reads, so the projection leaves it out. Update Ledgr or change that lump sum.`;
  },
  row: (row: unknown) =>
    `A saved Changes by year entry, ${quoted(row)}, isn't a row this version reads (its year, or its reset), so the projection leaves it out. Update Ledgr or change it.`,
};

/** A row's fields whose refusal drops the row: its year, and its reset (a
 *  reset row reverts and ignores the rest, so the rest alone would differ). */
const ROW_FIELDS = new Set(["year", "reset"]);

/** A saved set's rows as `element` reads them, each refused part left out
 *  and named in `notes`: a field, a lump sum, or a row (one that isn't a
 *  record, or a `ROW_FIELDS` field refused). The rest of the set runs. */
export function readableSavedRows(
  rows: readonly unknown[],
  element: z.ZodType,
  notes: string[],
): Record<string, unknown>[] {
  return rows.flatMap((row) => {
    const kept: Record<string, unknown> = isRecord(row) ? { ...row } : {};
    const year = String(kept.year);
    // Each pass drops one refused part, so this ends.
    while (isRecord(row)) {
      const issue = element.safeParse(kept).error?.issues[0];
      if (!issue) return [kept];
      const [field, index] = issue.path;
      const { lumpSums } = kept;
      const inLumpSums = field === "lumpSums" && typeof index === "number";
      if (inLumpSums && Array.isArray(lumpSums)) {
        const lumpSum: unknown = lumpSums[index];
        notes.push(
          refusedNotes.lumpSum(year, isRecord(lumpSum) ? lumpSum.amount : null),
        );
        kept.lumpSums = lumpSums.filter((_, i) => i !== index);
      } else if (
        typeof field === "string" &&
        !ROW_FIELDS.has(field) &&
        field in kept
      ) {
        notes.push(refusedNotes.field(year, field, kept[field]));
        Reflect.deleteProperty(kept, field);
      } else break;
    }
    notes.push(refusedNotes.row(row));
    return [];
  });
}

/** `saved`'s `fields` (each one it sets) with the `stored` row's entries for
 *  types this version doesn't know merged back, as a set's row keeps them. */
export function withStoredUnknownEntries(
  saved: Record<string, unknown>,
  stored: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const row = { ...saved };
  const part = unknownPart(stored, fields);
  if (part) mergeInto(row, part);
  return row;
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
