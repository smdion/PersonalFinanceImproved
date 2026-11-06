/** The stored SimpleFIN history the Current Balances figures are built
 *  from: each feed's balance reports and its funds' holdings reports. */
import { and, asc, eq, gte, isNotNull } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db";

/** Each feed's balance reports, oldest first. */
export async function loadBalanceReports(db: Db) {
  const b = schema.simplefinAccountBalances;
  const rows = await db.select().from(b).orderBy(asc(b.balanceDate));
  const byFeed = new Map<number, { reportedAt: Date; balance: number }[]>();
  for (const r of rows) {
    const list = byFeed.get(r.simplefinAccountId) ?? [];
    list.push({ reportedAt: r.balanceDate, balance: Number(r.balance) });
    byFeed.set(r.simplefinAccountId, list);
  }
  return byFeed;
}

/** Every stored holdings report since `since`, with fund details. */
export async function loadHoldingHistory(db: Db, since: string) {
  const h = schema.holdingObservations;
  const s = schema.securities;
  const rows = await db
    .select({
      simplefinAccountId: h.simplefinAccountId,
      securityId: h.securityId,
      asOf: h.asOf,
      balanceDate: h.balanceDate,
      shares: h.shares,
      value: h.reportedMarketValue,
      ticker: s.ticker,
      kind: s.kind,
    })
    .from(h)
    .innerJoin(s, eq(s.id, h.securityId))
    .where(and(isNotNull(h.simplefinAccountId), gte(h.asOf, since)))
    .orderBy(asc(h.balanceDate));
  return rows.map((r) => ({
    ...r,
    simplefinAccountId: r.simplefinAccountId!,
    shares: Number(r.shares),
    reportedMarketValue: r.value === null ? null : Number(r.value),
  }));
}
