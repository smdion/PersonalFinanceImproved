/** Entry refuses a snapshot row whose tax type its account type doesn't hold
 *  (`taxTypeRefusals`); a restore never does, and the read counts it. */
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db";
import type { PortfolioTaxType } from "@/lib/config/enum-values";
import type { z } from "zod/v4";
import {
  newRowRefusals,
  taxTypeRefusals,
  type RowFacts,
} from "@/lib/pure/accounts/tax-buckets/rebooked-rows";
import { getLatestSnapshot } from "@/server/data/snapshots";
import { createPortfolioSnapshot } from "@/server/services/net-worth/snapshot-write";
import type { portfolioSnapshotInput } from "./portfolio-snapshot-input";

/** Creates a snapshot, refusing a row entered with a tax type its account
 *  type doesn't hold; one carried over from the latest snapshot is not new
 *  (`newRowRefusals`). */
export async function createCheckedPortfolioSnapshot(
  ctx: { db: Db },
  input: z.infer<typeof portfolioSnapshotInput>,
) {
  const rows = input.accounts.map((a) => ({
    ...a,
    subType: a.subType ?? null,
    performanceAccountId: a.performanceAccountId ?? null,
  }));
  const previous = await getLatestSnapshot(ctx.db);
  const [refusal] = newRowRefusals(rows, previous ? previous.accounts : []);
  if (refusal)
    throw new TRPCError({ code: "BAD_REQUEST", message: refusal.message });
  return createPortfolioSnapshot(ctx, input);
}

/** Refuses `candidate`, read beside its snapshot's other rows. */
export function refuseUnheldTaxType(
  candidate: RowFacts,
  otherRows: readonly RowFacts[],
): void {
  const refusal = taxTypeRefusals([...otherRows, candidate]).find(
    (r) => r.row === candidate,
  );
  if (refusal)
    throw new TRPCError({ code: "BAD_REQUEST", message: refusal.message });
}

/** Refuses giving row `rowId` the tax type `taxType`. A missing row is the
 *  update's own concern; the row's own stored tax type, re-sent unchanged,
 *  is no new data and is never refused. */
export async function refuseTaxTypeEdit(
  db: Db,
  rowId: number,
  taxType: PortfolioTaxType,
): Promise<void> {
  const [stored] = await db
    .select({ snapshotId: schema.portfolioAccounts.snapshotId })
    .from(schema.portfolioAccounts)
    .where(eq(schema.portfolioAccounts.id, rowId));
  if (!stored) return;
  const rows = (await getLatestSnapshot(db, stored.snapshotId))?.accounts;
  const edited = rows?.find((r) => r.portfolioAccountId === rowId);
  if (!rows || !edited || edited.taxType === taxType) return;
  refuseUnheldTaxType(
    { ...edited, taxType },
    rows.filter((r) => r !== edited),
  );
}
