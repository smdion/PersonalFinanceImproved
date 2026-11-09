/**
 * Keeps `annual_performance` in step with edits to a year's
 * `account_performance` rows — the one path every edit takes (Performance
 * edits, account changes, snapshot balances), so the rollups can't drift
 * between callers (RULES §Single Computation Path).
 *
 * Usage: `captureYearRollups` before the write, `syncYearRollups` after it,
 * in the same transaction.
 *
 * - **Open year:** each category row (grouped by account type, the way
 *   finalize groups them) and Portfolio are rebuilt from the account rows.
 * - **Finalized year:** its rows are authoritative and may hold figures the
 *   account rows can't reproduce (overrides entered at finalize, imported
 *   history, a lifetime baseline from before tracking began). So only what
 *   the edit moved is carried in: each category and Portfolio move by the
 *   edit's change, and lifetime totals move by it in that year and every
 *   later one. Nothing else is recomputed.
 */
import { and, eq, gt } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { HALF_CENT } from "@/lib/constants";
import {
  PERF_CATEGORY_PORTFOLIO,
  PERF_CATEGORY_RETIREMENT,
} from "@/lib/config/display-labels";
import {
  addRollups,
  rebaseLockedReturn,
  rollupByCategory,
  rollupDeltas,
  sumAccounts,
  type Rollup,
} from "@/lib/pure/investments/returns";
import { toNumber, toNumberOrNull } from "@/lib/utils/numbers";
import type { DbOrTx } from "@/lib/db";
import {
  buildPerfAccountLookups,
  getEffectiveCategory,
  rollupColumns,
  money,
  rowRollup,
  pct,
} from "@/lib/pure/investments/annual-rollups";

type AnnualRow = typeof schema.annualPerformance.$inferSelect;

/** A year's per-category sums, taken before an edit. */
type YearRollups = { year: number; byCategory: Map<string, Rollup> };

export async function captureYearRollups(
  tx: DbOrTx,
  year: number,
): Promise<YearRollups> {
  // One query at a time: `tx` is usually a transaction's single connection.
  const rows = await tx
    .select()
    .from(schema.accountPerformance)
    .where(eq(schema.accountPerformance.year, year));
  const perfAccounts = await tx.select().from(schema.performanceAccounts);
  const byId = buildPerfAccountLookups(perfAccounts);
  return {
    year,
    byCategory: rollupByCategory(rows, (r) => getEffectiveCategory(r, byId)),
  };
}

/** Bring `before.year`'s rollups in step with its account rows after an edit. */
export async function syncYearRollups(
  tx: DbOrTx,
  before: YearRollups,
): Promise<void> {
  const { year } = before;
  const after = await captureYearRollups(tx, year);
  const yearRows = await tx
    .select()
    .from(schema.annualPerformance)
    .where(eq(schema.annualPerformance.year, year));
  const prevRows = await tx
    .select()
    .from(schema.annualPerformance)
    .where(eq(schema.annualPerformance.year, year - 1));
  const finalized = yearRows.some((r) => r.isFinalized);
  if (finalized) {
    await carryEditIntoLockedYear(tx, year, before, after, yearRows, prevRows);
  } else {
    await rebuildOpenYear(tx, year, after, yearRows, prevRows);
  }
}

async function rebuildOpenYear(
  tx: DbOrTx,
  year: number,
  after: YearRollups,
  yearRows: AnnualRow[],
  prevRows: AnnualRow[],
): Promise<void> {
  if (after.byCategory.size === 0) return;
  const existing = new Map(yearRows.map((r) => [r.category, r]));
  const prev = new Map(prevRows.map((r) => [r.category, r]));
  const isCurrentYear = yearRows.some((r) => r.isCurrentYear);

  const upsert = async (category: string, sums: Rollup) => {
    const p = prev.get(category);
    const values = {
      ...rollupColumns(sums),
      lifetimeGains: money(toNumber(p?.lifetimeGains) + sums.gainLoss),
      lifetimeContributions: money(
        toNumber(p?.lifetimeContributions) + sums.contribs,
      ),
      lifetimeMatch: money(toNumber(p?.lifetimeMatch) + sums.employer),
    };
    const row = existing.get(category);
    if (row) {
      await tx
        .update(schema.annualPerformance)
        .set(values)
        .where(eq(schema.annualPerformance.id, row.id));
    } else {
      await tx
        .insert(schema.annualPerformance)
        .values({ year, category, isCurrentYear, ...values });
    }
  };

  for (const [category, sums] of after.byCategory) await upsert(category, sums);

  // Portfolio sums every category row of the year — including one that
  // has no account rows (history kept only at the category level).
  const categoryTotals = new Map(after.byCategory);
  for (const r of yearRows) {
    if (
      r.category !== PERF_CATEGORY_PORTFOLIO &&
      r.category !== PERF_CATEGORY_RETIREMENT &&
      !categoryTotals.has(r.category)
    )
      categoryTotals.set(r.category, rowRollup(r));
  }
  await upsert(
    PERF_CATEGORY_PORTFOLIO,
    Array.from(categoryTotals.values()).reduce(addRollups, sumAccounts([])),
  );

  // Retirement is a read-time rollup over account-type categories; a stored
  // row would only ever be a stale copy.
  const stray = existing.get(PERF_CATEGORY_RETIREMENT);
  if (stray)
    await tx
      .delete(schema.annualPerformance)
      .where(eq(schema.annualPerformance.id, stray.id));
}

async function carryEditIntoLockedYear(
  tx: DbOrTx,
  year: number,
  before: YearRollups,
  after: YearRollups,
  yearRows: AnnualRow[],
  prevRows: AnnualRow[],
): Promise<void> {
  const deltas = rollupDeltas(before.byCategory, after.byCategory);
  if (deltas.size === 0) return;
  const existing = new Map(yearRows.map((r) => [r.category, r]));
  const prev = new Map(prevRows.map((r) => [r.category, r]));

  const carry = async (category: string, d: Rollup) => {
    const row = existing.get(category);
    if (!row) {
      // The edit put money in a category the locked year has no row for
      // (an account moved there): the row is just that category's figures.
      const sums = after.byCategory.get(category) ?? d;
      const p = prev.get(category);
      await tx.insert(schema.annualPerformance).values({
        year,
        category,
        ...rollupColumns(sums),
        lifetimeGains: money(toNumber(p?.lifetimeGains) + sums.gainLoss),
        lifetimeContributions: money(
          toNumber(p?.lifetimeContributions) + sums.contribs,
        ),
        lifetimeMatch: money(toNumber(p?.lifetimeMatch) + sums.employer),
        isFinalized: true,
        isImmutable: yearRows.some((r) => r.isImmutable),
      });
    } else {
      const was = rowRollup(row);
      const now = addRollups(was, d);
      await tx
        .update(schema.annualPerformance)
        .set({
          beginningBalance: money(now.beginBal),
          totalContributions: money(now.contribs),
          yearlyGainLoss: money(now.gainLoss),
          endingBalance: money(now.endBal),
          employerContributions: money(now.employer),
          distributions: money(now.distributions),
          fees: money(now.fees),
          rollovers: money(now.rollovers),
          annualReturnPct: pct(
            rebaseLockedReturn(
              {
                beginningBalance: was.beginBal,
                totalContributions: was.contribs,
                yearlyGainLoss: was.gainLoss,
                distributions: was.distributions,
                fees: was.fees,
                rollovers: was.rollovers,
                annualReturnPct: toNumberOrNull(row.annualReturnPct),
              },
              d,
            ),
          ),
          lifetimeGains: money(toNumber(row.lifetimeGains) + d.gainLoss),
          lifetimeContributions: money(
            toNumber(row.lifetimeContributions) + d.contribs,
          ),
          lifetimeMatch: money(toNumber(row.lifetimeMatch) + d.employer),
        })
        .where(eq(schema.annualPerformance.id, row.id));
    }
    await carryLifetimeForward(tx, year, category, d);
  };

  for (const [category, d] of deltas) await carry(category, d);
  // Portfolio moves by the net change (an account changing category nets
  // to nothing there).
  const net = rollupDeltas(
    new Map(),
    new Map([
      [
        PERF_CATEGORY_PORTFOLIO,
        Array.from(deltas.values()).reduce(addRollups, sumAccounts([])),
      ],
    ]),
  ).get(PERF_CATEGORY_PORTFOLIO);
  if (!net) return;
  if (existing.has(PERF_CATEGORY_PORTFOLIO))
    await carry(PERF_CATEGORY_PORTFOLIO, net);
  // No stored Portfolio row this year (the page sums one on read): later
  // years' stored Portfolio lifetime totals still include this year.
  else await carryLifetimeForward(tx, year, PERF_CATEGORY_PORTFOLIO, net);
}

/** Later years' lifetime totals in `category` move by what the edit moved. */
async function carryLifetimeForward(
  tx: DbOrTx,
  year: number,
  category: string,
  d: Rollup,
): Promise<void> {
  if (
    Math.abs(d.gainLoss) < HALF_CENT &&
    Math.abs(d.contribs) < HALF_CENT &&
    Math.abs(d.employer) < HALF_CENT
  )
    return;
  const later = await tx
    .select()
    .from(schema.annualPerformance)
    .where(
      and(
        eq(schema.annualPerformance.category, category),
        gt(schema.annualPerformance.year, year),
      ),
    );
  for (const r of later) {
    await tx
      .update(schema.annualPerformance)
      .set({
        lifetimeGains: money(toNumber(r.lifetimeGains) + d.gainLoss),
        lifetimeContributions: money(
          toNumber(r.lifetimeContributions) + d.contribs,
        ),
        lifetimeMatch: money(toNumber(r.lifetimeMatch) + d.employer),
      })
      .where(eq(schema.annualPerformance.id, r.id));
  }
}
