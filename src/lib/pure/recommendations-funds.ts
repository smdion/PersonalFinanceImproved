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
      const total = fs.reduce((s, f) => s + f.loss, 0);
      return {
        id: `harvest:${id}`,
        area: "investing",
        urgency: "soon",
        title: `Tax-loss harvesting in ${fs[0]!.accountLabel}`,
        action: `About ${formatCurrency(total, 0)} of losses you could realize (${fs.map((f) => f.fund).join(", ")}) — sell and buy a similar, not substantially identical fund`,
        context:
          "Wash-sale rule: a purchase of the same fund within 30 days in any account (a 401(k) reinvestment, a spouse's account) cancels the loss — Ledgr can't see those",
        impact: { kind: "oneTime", amount: total },
        href: "/portfolio",
        source: "ledgr",
      };
    }),
    ...args.cheaper.map((f): Recommendation => ({
      id: `cheaperFund:${f.simplefinAccountId}:${f.securityId}`,
      area: "investing",
      urgency: "soon",
      title: `Cheaper equivalent for ${f.fund}`,
      action: `${f.fund} costs ${formatPercent(f.expenseRatio, 2)} a year; an index fund for the same class, such as ${f.proxyLabel}, would save about ${formatCurrency(f.yearlySaving, 0)} a year`,
      context: `In ${f.accountLabel}. Saving counted down to ${formatPercent(LOW_COST_EXPENSE_RATIO, 2)}; in a taxable account, selling may realize gains`,
      impact: { kind: "perYear", amount: f.yearlySaving },
      href: "/portfolio",
      source: "ledgr",
    })),
  ];
}
