/** The lump-sum-targets tag, live and on restore: a saved lump sum that
 *  names its account gains that account's id and owner beside the names,
 *  or a null id when no single account matches. */
// No import from migration-converters.ts, which registers this one.
import { isRow, jsonArray, type Row, type Update } from "./converter-rows";

/** @internal The lump-sum-targets tag (tests import it; knip --production). */
export const LUMP_SUM_TARGETS_TAG = "0023_v0111_lump_sum_targets";

/** The saved sets that hold lump sums, as of this tag: the projection's
 *  per-year changes (each with `lumpSums`) and the Brokerage page's planned
 *  events (each a lump sum). */
const YEAR_SETS = ["accumulation", "decumulation"] as const;
const EVENT_SET = "brokerage";
/** What a match reads; a backup missing one is left as it is, never
 *  marked unmatched. */
const ACCOUNT_TABLES = [
  "performance_accounts",
  "portfolio_accounts",
  "portfolio_snapshots",
  "people",
] as const;

/** The one (performance account, owner) a stored name and owner name
 *  match by stored columns (`targetResolver`). */
type Target = { performanceAccountId: number; ownerPersonId: number | null };

/** Matches a name to the account's `display_name` or `account_label`, or a
 *  latest-snapshot row's `label`, held there by the owner of that stored
 *  name (any owner when none is named): exactly one, or null. */
function targetResolver(
  tables: Readonly<Record<string, readonly unknown[] | undefined>>,
) {
  const accounts = new Map<number, Row>();
  for (const a of (tables["performance_accounts"] ?? []).filter(isRow))
    accounts.set(Number(a["id"]), a);
  const peopleByName = new Map<string, number[]>();
  for (const p of (tables["people"] ?? []).filter(isRow)) {
    if (typeof p["name"] !== "string") continue;
    peopleByName.set(p["name"], [
      ...(peopleByName.get(p["name"]) ?? []),
      Number(p["id"]),
    ]);
  }
  const latest = latestSnapshotId(tables["portfolio_snapshots"] ?? []);
  const rows = (tables["portfolio_accounts"] ?? [])
    .filter(isRow)
    .filter(
      (r) =>
        Number(r["snapshot_id"]) === latest &&
        r["performance_account_id"] != null,
    );
  return (name: string, ownerName: string | null): Target | null => {
    let owner: number | null | undefined;
    if (ownerName !== null) {
      const ids = peopleByName.get(ownerName) ?? [];
      if (ids.length !== 1) return null;
      owner = ids[0];
    }
    const found = new Map<string, Target>();
    for (const r of rows) {
      const id = Number(r["performance_account_id"]);
      const a = accounts.get(id);
      const names = [a?.["display_name"], a?.["account_label"], r["label"]];
      if (!names.includes(name)) continue;
      const rowOwner =
        r["owner_person_id"] == null ? null : Number(r["owner_person_id"]);
      if (owner !== undefined && rowOwner !== owner) continue;
      found.set(`${id}|${rowOwner}`, {
        performanceAccountId: id,
        ownerPersonId: rowOwner,
      });
    }
    return found.size === 1 ? [...found.values()][0]! : null;
  };
}

/** The latest snapshot (by its "YYYY-MM-DD" date, then id): the one the
 *  projection's parts come from. Null when there is none. */
function latestSnapshotId(snapshots: readonly unknown[]): number | null {
  let best: { day: string; id: number } | null = null;
  for (const s of snapshots.filter(isRow)) {
    const next = { day: String(s["snapshot_date"]), id: Number(s["id"]) };
    if (
      !best ||
      next.day > best.day ||
      (next.day === best.day && next.id > best.id)
    )
      best = next;
  }
  return best?.id ?? null;
}

/** A lump sum with its target's ids (a null id when no single account
 *  matches), or null when it holds the id key already (the gate: the key,
 *  never its value) or names no account. */
function withTarget(
  lumpSum: unknown,
  resolve: ReturnType<typeof targetResolver>,
  counts: { written: number; unmatched: number },
): Row | null {
  if (!isRow(lumpSum) || Object.hasOwn(lumpSum, "targetPerformanceAccountId"))
    return null;
  const name = lumpSum["targetAccountName"];
  if (typeof name !== "string" || name === "") return null;
  const ownerName = lumpSum["targetOwnerName"];
  const target = resolve(
    name,
    typeof ownerName === "string" && ownerName !== "" ? ownerName : null,
  );
  if (!target) {
    counts.unmatched++;
    return { ...lumpSum, targetPerformanceAccountId: null };
  }
  counts.written++;
  return {
    ...lumpSum,
    targetPerformanceAccountId: target.performanceAccountId,
    targetOwnerPersonId: target.ownerPersonId,
  };
}

// Gated on structure only (a lump sum without the id key), and every named
// lump sum leaves with the key (a null id: matched no single account), so
// each converts once and a replay finds nothing to write.
export const LUMP_SUM_TARGETS_CONVERTER = {
  tables: ["projection_overrides", ...ACCOUNT_TABLES],
  runs: "afterSql",
  convert: (
    tables: Readonly<Record<string, readonly unknown[] | undefined>>,
  ) => {
    const updates: Update[] = [];
    if (ACCOUNT_TABLES.some((t) => !tables[t]))
      return { updates, notes: ["no account tables: nothing read"] };
    const resolve = targetResolver(tables);
    const counts = { written: 0, unmatched: 0 };
    for (const set of (tables["projection_overrides"] ?? []).filter(isRow)) {
      const kind = set["override_type"];
      const items = jsonArray(set["overrides"]);
      if (!items) continue;
      const next = items.map((item) => {
        if (kind === EVENT_SET)
          return withTarget(item, resolve, counts) ?? item;
        if (!YEAR_SETS.some((k) => k === kind) || !isRow(item)) return item;
        const lumpSums = item["lumpSums"];
        if (!Array.isArray(lumpSums)) return item;
        const converted = lumpSums.map(
          (ls: unknown) => withTarget(ls, resolve, counts) ?? ls,
        );
        return converted.some((ls, i) => ls !== lumpSums[i])
          ? { ...item, lumpSums: converted }
          : item;
      });
      const changed = next.some((item, i) => item !== items[i]);
      if (changed)
        updates.push({
          table: "projection_overrides",
          id: Number(set["id"]),
          set: { overrides: next },
        });
    }
    return {
      updates,
      notes: [
        `${counts.written} named lump sums gained their account's id; ${counts.unmatched} matched no single account and are marked so (null id)`,
      ],
    };
  },
} as const;

/** The tag's entry for MIGRATION_CONVERTERS. */
export const LUMP_SUM_TARGETS_CONVERTERS = {
  [LUMP_SUM_TARGETS_TAG]: LUMP_SUM_TARGETS_CONVERTER,
} as const;
