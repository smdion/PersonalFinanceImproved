/**
 * Cash-drag and HSA-cash recommendations — adapters over the findings
 * judged once in lib/pure/cash-positions.ts. Only maps fields.
 */
import type { CashFinding } from "@/lib/pure/cash-positions";
import type { Recommendation } from "@/lib/pure/recommendations";
import { formatCurrency } from "@/lib/utils/format";

export function recommendationsFromCash(args: {
  drag: readonly CashFinding[];
  hsa: readonly (CashFinding & { buffer: number })[];
}): Recommendation[] {
  return [
    ...args.drag.map((f): Recommendation => ({
      id: `cashDrag:${f.simplefinAccountId}`,
      area: "investing",
      urgency: "soon",
      title: `Uninvested cash in ${f.label}`,
      action: `About ${formatCurrency(f.excess, 0)} more cash than your target mix today calls for — invest it if it isn't set aside for something`,
      context: `Of ${formatCurrency(f.value, 0)} in the account`,
      impact: { kind: "oneTime", amount: f.excess },
      href: "/portfolio",
      source: "ledgr",
    })),
    ...args.hsa.map((f): Recommendation => ({
      id: `hsaCash:${f.simplefinAccountId}`,
      area: "investing",
      urgency: "soon",
      title: `HSA cash in ${f.label}`,
      action: `About ${formatCurrency(f.excess, 0)} above the ${formatCurrency(f.buffer, 0)} cash buffer — invest the rest`,
      context:
        "Buffer: your setting, or the year's HDHP minimum deductible for your coverage",
      impact: { kind: "oneTime", amount: f.excess },
      href: "/benchmarks",
      source: "ledgr",
    })),
  ];
}
