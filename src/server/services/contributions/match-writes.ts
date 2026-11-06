/** The one writer of employer match terms: every account and profile-entry
 *  write stores its rate through these (lib/pure/contributions/match-writes). */
import { TRPCError } from "@trpc/server";
import { eq, inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db";
import {
  MAX_MATCH_RATE,
  accountMatchColumns,
  entryWithMatchRate,
  matchRefused,
} from "@/lib/pure/contributions/match-writes";
import {
  PERCENT_MATCH,
  effectiveMatchType,
  percentFromRate,
} from "@/lib/utils/match-rate";

type Entry = Record<string, unknown>;
const isObject = (v: unknown): v is Entry =>
  typeof v === "object" && v !== null && !Array.isArray(v);
type Stored = string | number | null | undefined;

function assertMatchFits(...args: Parameters<typeof matchRefused>): void {
  if (matchRefused(...args))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `An employer match is 0% to ${MAX_MATCH_RATE * 100}%, to two decimals: enter 50 for 50%.`,
    });
}

/** An account write's match columns, refused when it raises the rate past
 *  the bound. `stored` is the row before (null on create). */
export function accountMatchWrite(
  type: string,
  incoming: { employerMatchValue?: Stored; employerMatchRate?: Stored },
  stored: {
    employerMatchType: string;
    employerMatchValue: Stored;
    employerMatchRate: Stored;
  } | null,
): ReturnType<typeof accountMatchColumns> {
  const columns = accountMatchColumns(type, incoming, stored);
  assertMatchFits(
    type === PERCENT_MATCH,
    { rate: columns.employerMatchRate, value: columns.employerMatchValue },
    {
      type: stored?.employerMatchType,
      rate: stored?.employerMatchRate,
      value: stored?.employerMatchValue,
    },
  );
  return columns;
}

/** A profile's entries after a write, each with its rate set by its
 *  account's type. `rateSent(id)`: the write sends that entry's rate. */
export async function entriesWithMatchRates(
  db: DbOrTx,
  entries: Readonly<Record<string, Entry>>,
  before: Readonly<Record<string, Entry | undefined>>,
  rateSent: (id: string, entry: Entry) => boolean,
): Promise<Record<string, Entry>> {
  const ids = Object.keys(entries).map(Number).filter(Number.isInteger);
  const accounts =
    ids.length === 0
      ? []
      : await db
          .select({
            id: schema.contributionAccounts.id,
            type: schema.contributionAccounts.employerMatchType,
            value: schema.contributionAccounts.employerMatchValue,
          })
          .from(schema.contributionAccounts)
          .where(inArray(schema.contributionAccounts.id, ids));
  const byId = new Map(accounts.map((a) => [String(a.id), a]));
  const out: Record<string, Entry> = {};
  for (const [id, entry] of Object.entries(entries)) {
    const account = byId.get(id);
    const sent = rateSent(id, entry);
    const next = entryWithMatchRate(entry, account, sent, before[id]);
    assertMatchFits(
      // A borrowed value isn't the write's: only the entry's own terms are bounded.
      effectiveMatchType(next, account?.type) === PERCENT_MATCH &&
        (sent ||
          entry["employerMatchValue"] != null ||
          entry["employerMatchRate"] != null),
      { rate: next["employerMatchRate"], value: next["employerMatchValue"] },
      {
        type: effectiveMatchType(before[id] ?? {}, account?.type),
        rate: before[id]?.["employerMatchRate"],
        value: before[id]?.["employerMatchValue"],
      },
    );
    out[id] = next;
  }
  return out;
}

/** A patch's unset keys: the value and its rate are one match, so
 *  unsetting either clears both (the entry then reads its account's). */
export function withMatchRateUnset(
  unset: string[] | undefined,
): string[] | undefined {
  const match = ["employerMatchValue", "employerMatchRate"];
  return unset?.some((k) => match.includes(k))
    ? [...new Set([...unset, ...match])]
    : unset;
}

/** A whole contributionActiveFields write (create, update): each entry's
 *  terms set by the one writer; a rate it carries with no value is kept,
 *  bounded when it differs from the stored one. */
export async function activeFieldsWithMatchRates<
  T extends { contributionAccounts?: Record<string, Entry> },
>(
  db: DbOrTx,
  fields: T,
  before: Readonly<Record<string, Entry | undefined>>,
): Promise<T> {
  if (!fields.contributionAccounts) return fields;
  const contributionAccounts = await entriesWithMatchRates(
    db,
    fields.contributionAccounts,
    before,
    () => false,
  );
  return { ...fields, contributionAccounts };
}

/** After an account's type changes, entries taking their type from it
 *  follow (entryWithMatchRate under percent; else a lone rate gains its
 *  percent as the value). Nothing re-bakes; no own rate is removed. */
export async function refreshEntryRates(
  db: DbOrTx,
  accountId: number,
  before:
    | { employerMatchType: string; employerMatchValue: string | null }
    | undefined,
  after: { employerMatchType: string; employerMatchValue: string | null },
): Promise<void> {
  if (before?.employerMatchType === after.employerMatchType) return;
  const account = {
    type: after.employerMatchType,
    value: after.employerMatchValue,
  };
  const key = String(accountId);
  const profiles = await db
    .select({
      id: schema.contributionProfiles.id,
      fields: schema.contributionProfiles.contributionActiveFields,
    })
    .from(schema.contributionProfiles);
  for (const p of profiles) {
    // A hand-edited column can hold JSON null: no entries to refresh.
    const fields: unknown = p.fields;
    if (!isObject(fields) || !isObject(fields["contributionAccounts"]))
      continue;
    const entry = p.fields.contributionAccounts?.[key];
    if (!isObject(entry) || Object.hasOwn(entry, "employerMatchType")) continue;
    const next = followAccountType(entry, account);
    if (
      next["employerMatchRate"] === entry["employerMatchRate"] &&
      next["employerMatchValue"] === entry["employerMatchValue"]
    )
      continue;
    await db
      .update(schema.contributionProfiles)
      .set({
        contributionActiveFields: {
          ...p.fields,
          contributionAccounts: {
            ...p.fields.contributionAccounts,
            [key]: next,
          },
        },
      })
      .where(eq(schema.contributionProfiles.id, p.id));
  }
}

function followAccountType(
  entry: Entry,
  account: { type: string; value: string | null },
): Entry {
  if (account.type === PERCENT_MATCH)
    return entryWithMatchRate(entry, account, false, entry);
  const rate = entry["employerMatchRate"];
  return entry["employerMatchValue"] == null && rate != null
    ? { ...entry, employerMatchValue: percentFromRate(rate) }
    : entry;
}
