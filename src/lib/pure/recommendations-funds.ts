/**
 * Tax-loss-harvesting and cheaper-fund recommendations — adapters over the
 * findings judged once in lib/pure/fund-findings.ts. Only maps fields.
 */
import type {
  CheaperFundFinding,
  HarvestFinding,
} from "@/lib/pure/fund-findings";
import type { Recommendation } from "@/lib/pure/recommendations";
import { LOW_COST_EXPENSE_RATIO } from "@/lib/config/milestones";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { sumBy } from "@/lib/utils/math";

export function recommendationsFromFunds(args: {
  harvest: readonly HarvestFinding[];
  cheaper: readonly CheaperFundFinding[];
}): Recommendation[] {
  const byAccount = new Map<number, HarvestFinding[]>();
  for (const f of args.harvest)
    byAccount.set(f.simplefinAccountId, [
      ...(byAccount.get(f.simplefinAccountId) ?? []),
      f,
    ]);
  return [
    ...[...byAccount.entries()].map(([id, fs]): Recommendation => {
      const total = sumBy(fs, (f) => f.loss);
      return {
        id: `harvest:${id}`,
        area: "investing",
        urgency: "soon",
        title: `Tax-loss harvesting in ${fs[0]!.accountLabel}`,
        action: `Harvest about ${formatCurrency(total, 0)} of losses in ${fs[0]!.accountLabel}: ${fs.map((f) => f.fund).join(", ")}`,
        context:
          "Sell and buy a similar, not substantially identical fund. Wash-sale rule: buying the same fund within 30 days in any account (a 401(k) reinvestment, a spouse's account) cancels the loss.",
        impact: { kind: "oneTime", amount: total },
        focus: { topic: "holdings" },
        source: "ledgr",
      };
    }),
    ...args.cheaper.map((f): Recommendation => ({
      id: `cheaperFund:${f.simplefinAccountId}:${f.securityId}`,
      area: "investing",
      urgency: "soon",
      title: `Cheaper equivalent for ${f.fund}`,
      action: `Swap ${f.fund} (${formatPercent(f.expenseRatio, 2)} a year) in ${f.accountLabel} for a low-cost index fund like ${f.proxyLabel}`,
      context: `Saves about ${formatCurrency(f.yearlySaving, 0)} a year, counted down to a ${formatPercent(LOW_COST_EXPENSE_RATIO, 2)} expense ratio (the fund's yearly cost). In a taxable account, selling may realize gains.`,
      impact: { kind: "perYear", amount: f.yearlySaving },
      focus: { topic: "holdings" },
      source: "ledgr",
    })),
  ];
}
