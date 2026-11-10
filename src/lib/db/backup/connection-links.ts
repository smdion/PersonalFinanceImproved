/**
 * A non-admin's restore or import keeps a connection's current links only
 * where they still name the same row in the restored data (owner decision).
 */
import type { z } from "zod/v4";
import { mappingWithTypedIds } from "@/lib/pure/sync/account-mapping";
import { accountMappingSchema } from "../shapes/json-schemas";

type Row = Record<string, unknown>;
type Mapping = z.infer<typeof accountMappingSchema>;

/** The tables a link names, and the column that names each row. */
const TARGETS = {
  asset: { table: "other_asset_items", name: "name" },
  loan: { table: "mortgage_loans", name: "name" },
  debt: { table: "debts", name: "name" },
  performance: { table: "performance_accounts", name: "account_label" },
  profile: { table: "budget_profiles", name: "name" },
} as const;
type Target = keyof typeof TARGETS;

/** Each target table's rows by id. */
export type TargetRows = Record<Target, Map<number, Row>>;

/** The link columns this file decides; installation-rows.ts lists them. */
export const MATCHED_LINK_COLUMNS = [
  "account_mappings",
  "linked_profile_id",
  "linked_column_index",
] as const;

/** The target tables' rows by id, from `rowsOf(table)`. */
export async function targetRows(
  rowsOf: (table: string) => Promise<Row[]>,
): Promise<TargetRows> {
  const byId = async (target: Target) =>
    new Map(
      (await rowsOf(TARGETS[target].table)).map((r) => [Number(r["id"]), r]),
    );
  return {
    asset: await byId("asset"),
    loan: await byId("loan"),
    debt: await byId("debt"),
    performance: await byId("performance"),
    profile: await byId("profile"),
  };
}

/** A jsonb value as read: parsed (PostgreSQL) or JSON text (SQLite). */
function parsed(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const value: unknown = JSON.parse(v);
  return value;
}

/** Today's row `id` of `target` is the restored row with that id: both
 *  exist and carry the same name. Never by name alone. */
function sameRow(
  target: Target,
  id: number,
  today: TargetRows,
  restored: TargetRows,
): boolean {
  const column = TARGETS[target].name;
  const now = today[target].get(id)?.[column];
  return now != null && restored[target].get(id)?.[column] === now;
}

/** The local row a mapping names, one per part (a mortgage's property value
 *  and its balance apart); null for the Cash and Credit Card pseudo-accounts. */
function targetOf(
  raw: unknown,
): { target: Target; id: number; key: string } | null {
  const read = accountMappingSchema.safeParse(raw);
  if (!read.success) return null;
  const m: Mapping = mappingWithTypedIds(read.data);
  if (m.assetId != null)
    return { target: "asset", id: m.assetId, key: `asset:${m.assetId}` };
  if (m.loanId != null)
    return {
      target: "loan",
      id: m.loanId,
      key: `loan:${m.loanId}:${m.loanMapType ?? ""}`,
    };
  if (m.debtId != null)
    return { target: "debt", id: m.debtId, key: `debt:${m.debtId}` };
  if (m.performanceAccountId != null)
    return {
      target: "performance",
      id: m.performanceAccountId,
      key: `performance:${m.performanceAccountId}`,
    };
  return null;
}

/** Whether today's mapping still names the same row after the restore; the
 *  Cash and Credit Card pseudo-accounts always do. Never by `localName`. */
function holds(raw: unknown, today: TargetRows, restored: TargetRows): boolean {
  const read = accountMappingSchema.safeParse(raw);
  if (!read.success) return false;
  const target = targetOf(raw);
  if (!target)
    return read.data.localId === "cash" || read.data.localId === "creditCard";
  return sameRow(target.target, target.id, today, restored);
}

/** The remote account a mapping uses: one mapping each (a save refuses two
 *  pulled ones, remotesPulledTwice); a mortgage's two parts differ by row key. */
function remoteOf(raw: unknown): string | null {
  const read = accountMappingSchema.safeParse(raw);
  return read.success ? read.data.remoteAccountId : null;
}

/** Today's mappings that hold, then the backup's for every other remote
 *  account, none naming a row a kept mapping names. */
function mergedMappings(
  ours: unknown,
  theirs: unknown,
  today: TargetRows,
  restored: TargetRows,
): unknown {
  const list = (v: unknown): unknown[] => {
    const value = parsed(v);
    return Array.isArray(value) ? value : [];
  };
  const kept = list(ours).filter((m) => holds(m, today, restored));
  const remotes = new Set(kept.map(remoteOf));
  const rows = new Set(kept.map((m) => targetOf(m)?.key));
  const taken = list(theirs).filter((m) => {
    const row = targetOf(m)?.key;
    return !remotes.has(remoteOf(m)) && (row == null || !rows.has(row));
  });
  const merged = [...kept, ...taken];
  if (merged.length === 0 && parsed(theirs) == null) return null;
  return typeof ours === "string" || typeof theirs === "string"
    ? JSON.stringify(merged)
    : merged;
}

/** Today's linked profile and column where the profile is the same row and
 *  the column at that index has the same label; else the backup's pair. */
function linkedPair(
  ours: Row,
  theirs: Row | undefined,
  today: TargetRows,
  restored: TargetRows,
): Row {
  const id = ours["linked_profile_id"];
  const index = ours["linked_column_index"];
  const label = (rows: TargetRows): unknown => {
    const labels = parsed(rows.profile.get(Number(id))?.["column_labels"]);
    return Array.isArray(labels) && typeof index === "number"
      ? labels[index]
      : undefined;
  };
  const columnHolds =
    index == null || (label(today) != null && label(today) === label(restored));
  if (
    id != null &&
    sameRow("profile", Number(id), today, restored) &&
    columnHolds
  )
    return { linked_profile_id: id, linked_column_index: index };
  return {
    linked_profile_id: theirs?.["linked_profile_id"] ?? null,
    linked_column_index: theirs?.["linked_column_index"] ?? null,
  };
}

/** A connection's mappings and linked profile and column after a non-admin's
 *  restore or import: today's where they hold, else the backup's. */
export function matchedLinks(
  ours: Row,
  theirs: Row | undefined,
  today: TargetRows,
  restored: TargetRows,
): Row {
  return {
    account_mappings: mergedMappings(
      ours["account_mappings"],
      theirs?.["account_mappings"],
      today,
      restored,
    ),
    ...linkedPair(ours, theirs, today, restored),
  };
}
