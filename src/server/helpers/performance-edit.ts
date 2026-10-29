/**
 * An edit to one Performance account row — the single write path for inline
 * edits, and for previewing one (run it, report what moved, roll back).
 *
 * - A row that balanced before stays balanced: when the edit doesn't set
 *   the gain itself, the gain follows the other figures. A row carrying a
 *   deliberate gap (a provider's gain) keeps its gain.
 * - `chainNextYear`: when the ending moves and next year's row (same account
 *   and person) began at the old ending, it begins at the new one. Its gain
 *   follows only if that row balanced before.
 * - Every affected year's rollups move through syncYearRollups, the edited
 *   year first (next year's rebuild reads its lifetime figures).
 */
import { and, eq, gte } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { HALF_CENT } from "@/lib/constants";
import { computeGainLoss } from "@/lib/pure/performance";
import type { PerfCheck } from "@/lib/pure/performance-checks";
import {
  captureYearRollups,
  syncYearRollups,
} from "@/server/helpers/performance-rollups";
import { loadPerformanceChecks } from "@/server/helpers/performance-checks";
import { toNumber, type DbOrTx } from "@/server/helpers/transforms";

type AccountPerfRow = typeof schema.accountPerformance.$inferSelect;
type AnnualRow = typeof schema.annualPerformance.$inferSelect;

const EDITABLE_ACCOUNT_FIELDS = [
  "beginningBalance",
  "totalContributions",
  "employerContributions",
  "distributions",
  "rollovers",
  "fees",
  "endingBalance",
  "yearlyGainLoss",
] as const;
type EditableAccountField = (typeof EDITABLE_ACCOUNT_FIELDS)[number];
export type AccountEdit = Partial<Record<EditableAccountField, string>>;

const ANNUAL_FIELDS = [
  "beginningBalance",
  "totalContributions",
  "employerContributions",
  "distributions",
  "fees",
  "rollovers",
  "yearlyGainLoss",
  "endingBalance",
  "annualReturnPct",
  "lifetimeGains",
  "lifetimeContributions",
  "lifetimeMatch",
] as const;

type FieldChange = {
  field: string;
  from: number | null;
  to: number | null;
};
export type EditPreview = {
  /** Account rows that changed (the edited one, and next year's if chained). */
  accounts: { id: number; year: number; changes: FieldChange[] }[];
  /** annual_performance rows that changed, every affected year. */
  rollups: { year: number; category: string; changes: FieldChange[] }[];
  /** Next year's row began at this row's old ending (so it can follow). */
  chainable: { nextYear: number; rowId: number } | null;
  /** Checks on the changed rows after the edit. */
  checks: Record<number, PerfCheck[]>;
};

const figures = (r: AccountPerfRow) => ({
  beginningBalance: toNumber(r.beginningBalance),
  totalContributions: toNumber(r.totalContributions),
  distributions: toNumber(r.distributions),
  rollovers: toNumber(r.rollovers),
  fees: toNumber(r.fees),
  endingBalance: toNumber(r.endingBalance),
});
const balanced = (r: AccountPerfRow) =>
  Math.abs(computeGainLoss(figures(r)) - toNumber(r.yearlyGainLoss)) <
  HALF_CENT;

function diff<T extends Record<string, unknown>>(
  before: T | undefined,
  after: T | undefined,
  fields: readonly (keyof T & string)[],
): FieldChange[] {
  const num = (v: unknown) => (v == null ? null : toNumber(String(v)));
  return fields.flatMap((field) => {
    const from = num(before?.[field]);
    const to = num(after?.[field]);
    const tol = field === "annualReturnPct" ? 5e-7 : HALF_CENT;
    return from === to ||
      (from != null && to != null && Math.abs(from - to) < tol)
      ? []
      : [{ field, from, to }];
  });
}

export async function editAccountRow(
  tx: DbOrTx,
  id: number,
  edit: AccountEdit,
  opts: { chainNextYear?: boolean } = {},
): Promise<EditPreview | null> {
  const [row] = await tx
    .select()
    .from(schema.accountPerformance)
    .where(eq(schema.accountPerformance.id, id));
  if (!row) return null;

  const nextRows = await tx
    .select()
    .from(schema.accountPerformance)
    .where(
      and(
        eq(schema.accountPerformance.year, row.year + 1),
        eq(
          schema.accountPerformance.performanceAccountId,
          row.performanceAccountId,
        ),
      ),
    );
  const sameOwner = nextRows.filter(
    (r) => r.ownerPersonId === row.ownerPersonId,
  );
  const next = sameOwner.length === 1 ? sameOwner[0]! : null;
  const endingMoves =
    edit.endingBalance !== undefined &&
    Math.abs(toNumber(edit.endingBalance) - toNumber(row.endingBalance)) >=
      HALF_CENT;
  const chainable =
    next &&
    Math.abs(toNumber(next.beginningBalance) - toNumber(row.endingBalance)) <
      HALF_CENT
      ? { nextYear: next.year, rowId: next.id }
      : null;
  const chain = !!(opts.chainNextYear && endingMoves && chainable && next);

  const annualBefore = await tx
    .select()
    .from(schema.annualPerformance)
    .where(gte(schema.annualPerformance.year, row.year));
  const beforeN = await captureYearRollups(tx, row.year);
  const beforeNext = chain ? await captureYearRollups(tx, row.year + 1) : null;

  // The edited row.
  const updates: Record<string, string> = { ...edit };
  if (edit.yearlyGainLoss === undefined && balanced(row)) {
    const merged = { ...row, ...updates } as AccountPerfRow;
    updates.yearlyGainLoss = computeGainLoss(figures(merged)).toFixed(2);
  }
  await tx
    .update(schema.accountPerformance)
    .set(updates)
    .where(eq(schema.accountPerformance.id, row.id));

  // Next year begins where this one now ends.
  if (chain && next) {
    const nextUpdates: Record<string, string> = {
      beginningBalance: toNumber(edit.endingBalance).toFixed(2),
    };
    if (balanced(next)) {
      const merged = { ...next, ...nextUpdates } as AccountPerfRow;
      nextUpdates.yearlyGainLoss = computeGainLoss(figures(merged)).toFixed(2);
    }
    await tx
      .update(schema.accountPerformance)
      .set(nextUpdates)
      .where(eq(schema.accountPerformance.id, next.id));
  }

  await syncYearRollups(tx, beforeN);
  if (beforeNext) await syncYearRollups(tx, beforeNext);

  // What moved.
  const changedIds = chain && next ? [row.id, next.id] : [row.id];
  const accountsAfter = await tx
    .select()
    .from(schema.accountPerformance)
    .where(gte(schema.accountPerformance.year, row.year));
  const accountBefore = new Map(
    [row, ...(next ? [next] : [])].map((r) => [r.id, r]),
  );
  const annualAfter = await tx
    .select()
    .from(schema.annualPerformance)
    .where(gte(schema.annualPerformance.year, row.year));
  const key = (r: AnnualRow) => `${r.year}|${r.category}`;
  const beforeByKey = new Map(annualBefore.map((r) => [key(r), r]));
  const afterByKey = new Map(annualAfter.map((r) => [key(r), r]));
  const rollups = Array.from(
    new Set([...beforeByKey.keys(), ...afterByKey.keys()]),
  )
    .map((k) => {
      const [year, category] = [Number(k.split("|")[0]), k.split("|")[1]!];
      return {
        year,
        category,
        changes: diff(beforeByKey.get(k), afterByKey.get(k), ANNUAL_FIELDS),
      };
    })
    .filter((r) => r.changes.length > 0)
    .sort((a, b) => a.year - b.year || a.category.localeCompare(b.category));

  const checks = await loadPerformanceChecks(tx);
  return {
    accounts: changedIds.map((cid) => {
      const after = accountsAfter.find((r) => r.id === cid);
      return {
        id: cid,
        year: after?.year ?? row.year,
        changes: diff(accountBefore.get(cid), after, EDITABLE_ACCOUNT_FIELDS),
      };
    }),
    rollups,
    chainable,
    checks: Object.fromEntries(
      changedIds.map((cid) => [cid, checks.get(cid) ?? []]),
    ),
  };
}
