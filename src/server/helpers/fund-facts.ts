/** Stored security_facts rows → the pure FactRow shape; bucket links. */
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { CompositionBucket } from "@/lib/config/enum-values";
import type { FactRow } from "@/lib/pure/fund-facts";
import type { Db } from "./transforms";

/**
 * Which active asset class each composition bucket counts toward. A link to
 * an inactive class doesn't count (the bucket shows as left out).
 */
export async function loadBucketLinks(
  db: Db,
): Promise<Map<CompositionBucket, number>> {
  const l = schema.assetClassBuckets;
  const a = schema.assetClassParams;
  const rows = await db
    .select({ bucket: l.bucket, assetClassId: l.assetClassId })
    .from(l)
    .innerJoin(a, eq(a.id, l.assetClassId))
    .where(eq(a.isActive, true));
  return new Map(rows.map((r) => [r.bucket, r.assetClassId]));
}

export function toFactRows(
  rows: (typeof schema.securityFacts.$inferSelect)[],
): FactRow[] {
  const n = (v: string | null) => (v === null ? null : Number(v));
  return rows.map((r) => ({
    source: r.source,
    asOf: r.asOf,
    expenseRatio: n(r.expenseRatio),
    composition:
      r.coverage === null
        ? null
        : {
            us_equity: n(r.usEquityPct) ?? 0,
            intl_equity: n(r.intlEquityPct) ?? 0,
            us_bond: n(r.usBondPct) ?? 0,
            intl_bond: n(r.intlBondPct) ?? 0,
            tips: n(r.tipsPct) ?? 0,
            cash: n(r.cashPct) ?? 0,
            other: n(r.otherPct) ?? 0,
            coverage: n(r.coverage) ?? 0,
          },
  }));
}
