/** Stored security_facts rows → the pure FactRow shape. */
import type * as schema from "@/lib/db/schema";
import type { FactRow } from "@/lib/pure/fund-facts";

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
