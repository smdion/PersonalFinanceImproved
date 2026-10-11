/**
 * Which SimpleFIN transactions a saved Performance / basis fill already
 * counted (see lib/pure/flow-suggestions.ts). One app setting, per scope
 * and year: each row's baseline day (fixed at its first fill) and the
 * counted transaction ids with how each was counted.
 */
import { z } from "zod/v4";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Db, DbOrTx } from "./transforms";

export const FILL_LEDGER_KEY = "simplefin_fill_ledger";

export type FillScope = "performance" | "basis";

export type FillRecord = {
  /** Row id → the day its stored figures ran through before the first fill. */
  baselines: Record<string, string>;
  /** Transaction id → how it was counted ("removed" once taken back out). */
  counted: Record<string, string>;
};

type Ledger = Partial<Record<FillScope, Record<string, FillRecord>>>;

const day = z.iso.date();

/** What a form sends back with a save made from a fill. */
export const zFillRecord = z.object({
  year: z.number().int(),
  baselines: z.record(z.string(), day),
  counted: z.record(
    z.string(),
    z.string().regex(/^(?:[a-z_]+(?::conversion)?|removed)$/),
  ),
});

async function readLedger(db: DbOrTx): Promise<Ledger> {
  const rows = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, FILL_LEDGER_KEY));
  const v = rows[0]?.value;
  return v && typeof v === "object" ? (v as Ledger) : {};
}

export async function loadFillRecord(
  db: Db,
  scope: FillScope,
  year: number,
): Promise<FillRecord> {
  const r = (await readLedger(db))[scope]?.[year];
  return { baselines: r?.baselines ?? {}, counted: r?.counted ?? {} };
}

/**
 * Merge a saved fill into the ledger. Only transactions that exist and
 * were posted in that year are recorded, and a row's baseline is fixed at
 * its first fill.
 */
export async function recordFill(
  tx: DbOrTx,
  scope: FillScope,
  fill: z.infer<typeof zFillRecord>,
) {
  const ids = Object.keys(fill.counted).map(Number).filter(Number.isInteger);
  const known = ids.length
    ? await tx
        .select({ id: schema.investmentTransactions.id })
        .from(schema.investmentTransactions)
        .where(
          and(
            inArray(schema.investmentTransactions.id, ids),
            gte(schema.investmentTransactions.posted, `${fill.year}-01-01`),
            lte(schema.investmentTransactions.posted, `${fill.year}-12-31`),
          ),
        )
    : [];
  const ledger = await readLedger(tx);
  const scoped = (ledger[scope] ??= {});
  const record = (scoped[fill.year] ??= { baselines: {}, counted: {} });
  for (const [row, baseline] of Object.entries(fill.baselines))
    if (
      record.baselines[row] === undefined &&
      baseline >= `${fill.year - 1}-12-31` &&
      baseline <= `${fill.year}-12-31`
    )
      record.baselines[row] = baseline;
  for (const { id } of known) record.counted[id] = fill.counted[id]!;
  await tx
    .insert(schema.appSettings)
    .values({ key: FILL_LEDGER_KEY, value: ledger })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: ledger },
    });
}
