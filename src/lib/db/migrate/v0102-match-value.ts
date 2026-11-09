/** Migration 0017 and its restore step: a percent match keeps its rate
 *  alone. Where 0016 set a rate, the whole-percent value goes; a dollar
 *  entry that borrowed it first gets it as its own. Rules: MATCH_VALUE_CONVERTER. */
// No import from migration-converters.ts, which registers this one.
import {
  PERCENT_MATCH as PERCENT,
  effectiveMatchType,
  percentFromRate,
} from "../../utils/match-rate";
import {
  isEmpty,
  isRow,
  jsonObject,
  type Row,
  type Update,
} from "./converter-rows";

export const MATCH_VALUE_TAG = "0017_v0102_match_value";

/** A rate the readers read (storedMatchRate): only then may the value go. */
const readable = (rate: unknown) =>
  !isEmpty(rate) && percentFromRate(rate) !== null;
/** Types whose value is dollars (parseEmployerMatch: "flat"), as 0017
 *  found them. */
const DOLLARS = new Set<unknown>(["dollar_match", "fixed_annual"]);

/** A percent row holding a value: cleared where its rate reads, else kept. */
const percentWithValue = (r: Row) =>
  r["employer_match_type"] === PERCENT && !isEmpty(r["employer_match_value"]);

/** One entry after 0017: a dollar type alone over a cleared account takes
 *  the value it borrowed (decision 14); a percent entry's own value goes
 *  where its own rate is set. Null: unchanged. */
function entryAfter(
  entry: Row,
  account: Row | undefined,
  cleared: boolean,
): Row | null {
  const type = effectiveMatchType(entry, account?.["employer_match_type"]);
  const own = Object.hasOwn(entry, "employerMatchValue");
  if (DOLLARS.has(type) && !own && cleared)
    return { ...entry, employerMatchValue: account?.["employer_match_value"] };
  if (type !== PERCENT || !readable(entry["employerMatchRate"])) return null;
  if (!own || isEmpty(entry["employerMatchValue"])) return null;
  const { employerMatchValue: _cleared, ...rest } = entry;
  return rest;
}

/** Each profile whose entries 0017 changes, and how many it changed. */
function profileUpdates(
  profiles: readonly Row[],
  accounts: ReadonlyMap<string, Row>,
  cleared: ReadonlySet<string>,
): { updates: Update[]; copied: number; entries: number } {
  const updates: Update[] = [];
  const out = { updates, copied: 0, entries: 0 };
  for (const profile of profiles) {
    const fields = jsonObject(profile["contribution_active_fields"]);
    const entries = fields?.["contributionAccounts"];
    if (!fields || !isRow(entries)) continue;
    const next: Row = { ...entries };
    let changed = false;
    for (const [accountId, entry] of Object.entries(entries)) {
      if (!isRow(entry)) continue;
      const after = entryAfter(
        entry,
        accounts.get(accountId),
        cleared.has(accountId),
      );
      if (!after) continue;
      if (Object.hasOwn(after, "employerMatchValue")) out.copied++;
      else out.entries++;
      next[accountId] = after;
      changed = true;
    }
    if (changed)
      out.updates.push({
        table: "contribution_profiles",
        id: Number(profile["id"]),
        set: {
          contribution_active_fields: { ...fields, contributionAccounts: next },
        },
      });
  }
  return out;
}

/** Idempotent by storage: it clears only a value beside a rate it reads
 *  (rows 0016 skipped keep theirs, as the reader falls back to them), and
 *  copies only into a dollar entry with no value over an account it clears. */
export const MATCH_VALUE_CONVERTER = {
  tables: ["contribution_accounts", "contribution_profiles"],
  runs: "afterSql",
  convert: (
    tables: Readonly<Record<string, readonly unknown[] | undefined>>,
  ) => {
    const accounts = (tables["contribution_accounts"] ?? []).filter(isRow);
    const withValue = accounts.filter(percentWithValue);
    const clear = withValue.filter((a) => readable(a["employer_match_rate"]));
    const byId = new Map(accounts.map((a) => [String(a["id"]), a]));
    const profiles = (tables["contribution_profiles"] ?? []).filter(isRow);
    const p = profileUpdates(
      profiles,
      byId,
      new Set(clear.map((a) => String(a["id"]))),
    );
    const updates: Update[] = [
      ...p.updates,
      ...clear.map((a) => ({
        table: "contribution_accounts",
        id: Number(a["id"]),
        set: { employer_match_value: null },
      })),
    ];
    const kept = withValue.filter((a) => !clear.includes(a));
    const notes = [
      `${clear.length} account values, ${p.entries} entry values cleared; ${p.copied} dollar entries given the account's value`,
    ];
    if (kept.length > 0)
      notes.push(
        `kept their value (no rate): ${kept.map((a) => `account ${String(a["id"])}`).join(", ")}`,
      );
    return { updates, notes };
  },
} as const;
