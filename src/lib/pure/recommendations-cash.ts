/**
 * Cash-drag and HSA-cash recommendations — adapters over the findings
 * judged once in lib/pure/cash-positions.ts. Only maps fields.
 */
import type { CashFinding } from "@/lib/pure/cash-positions";
import type { Recommendation } from "@/lib/pure/recommendations";
import { formatCurrency, formatList, formatPercent } from "@/lib/utils/format";
import { goldilocksPlan } from "@/lib/pure/goldilocks";

export function recommendationsFromCash(args: {
  drag: readonly CashFinding[];
  hsa: readonly (CashFinding & { buffer: number })[];
  /** Asset classes under target (classesUnderTarget) — investing the
   *  cash there also rebalances. */
  underTarget?: readonly string[];
  /** The household's invested money now (liquid less cash) — paces a large
   *  amount by Money Guy's Goldilocks rule. Omitted = no pacing note. */
  investedAssets?: number;
}): Recommendation[] {
  const rebalanceNote = args.underTarget?.length
    ? ` Putting it into ${formatList([...args.underTarget])} (under target) also rebalances.`
    : "";
  return [
    ...args.drag.map((f): Recommendation => ({
      id: `cashDrag:${f.simplefinAccountId}`,
      area: "investing",
      urgency: "soon",
      title: `Uninvested cash in ${f.label}`,
      action: `Invest about ${formatCurrency(f.excess, 0)} of idle cash in ${f.label}`,
      context: `More cash than your target mix holds, out of ${formatCurrency(f.value, 0)} in the account — skip it if the cash is set aside for something.${rebalanceNote}${pacingNote(f.excess, args.investedAssets)}`,
      impact: { kind: "oneTime", amount: f.excess },
      focus: { topic: "holdings" },
      source: "ledgr",
    })),
    ...args.hsa.map((f): Recommendation => ({
      id: `hsaCash:${f.simplefinAccountId}`,
      area: "investing",
      urgency: "soon",
      title: `HSA cash in ${f.label}`,
      action: `Invest about ${formatCurrency(f.excess, 0)} of HSA cash in ${f.label}`,
      context: `Keeps ${formatCurrency(f.buffer, 0)} on hand — your setting, or the year's HDHP minimum deductible for your coverage.`,
      impact: { kind: "oneTime", amount: f.excess },
      focus: { topic: "holdings" },
      source: "ledgr",
    })),
  ];
}

/** Money Guy's Goldilocks rule for a large amount: spread it out. Nothing
 *  under 10% of what's invested ("invest it" already says it). */
function pacingNote(amount: number, investedAssets: number | undefined) {
  const plan =
    investedAssets === undefined
      ? null
      : goldilocksPlan(amount, investedAssets);
  if (!plan || plan.months === 0) return "";
  return ` At ${formatPercent(plan.share, 0)} of what's already invested, Money Guy's Goldilocks rule spreads it over ${plan.months} months.`;
}
