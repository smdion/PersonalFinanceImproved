/**
 * Per-fund findings — judged once here; the tax-loss-harvesting and
 * cheaper-fund recommendations map them.
 *
 * Tax-loss harvesting: positions in taxable accounts (account-type config)
 * worth noticeably less than the institution's reported average cost.
 * Only where average cost is reported; wash-sale buys elsewhere (a 401(k)
 * reinvestment, a spouse's account) aren't visible, so the item says so.
 *
 * Cheaper equivalent fund: a single-class fund (one composition bucket
 * dominates) in an IRA or taxable account whose expense ratio sits well
 * above the low-cost line; the same class's index proxy is named and the
 * yearly saving is measured to that line (proxy fees aren't stored, so the
 * line — not a proxy figure — is what the saving is counted against).
 */
import { isIraCategory } from "@/lib/config/account-types";
import {
  COMPOSITION_BUCKET_VALUES,
  type CompositionBucket,
} from "@/lib/config/enum-values";
import { BUCKET_INDEX_PROXIES } from "@/lib/config/benchmarks";
import { LOW_COST_EXPENSE_RATIO } from "@/lib/config/milestones";
import { CHEAPER_FUND, TAX_LOSS_HARVEST } from "@/lib/config/recommendations";
import { isTaxableAccountType } from "@/lib/pure/investment-income";
import type { EffectiveFacts } from "@/lib/pure/fund-facts";

export type FundAccountInput = {
  simplefinAccountId: number;
  label: string;
  accountType: string | null;
  holdings: readonly {
    securityId: number;
    name: string;
    symbol: string | null;
    shares: number;
    value: number;
    avgCostPerShare: number | null;
    facts: EffectiveFacts;
  }[];
};

export type HarvestFinding = {
  simplefinAccountId: number;
  accountLabel: string;
  fund: string;
  /** Unrealized loss (positive dollars). */
  loss: number;
};

export function judgeTaxLossHarvest(
  accounts: readonly FundAccountInput[],
): HarvestFinding[] {
  const out: HarvestFinding[] = [];
  for (const a of accounts) {
    if (!isTaxableAccountType(a.accountType)) continue;
    for (const h of a.holdings) {
      if (h.avgCostPerShare === null || h.shares <= 0) continue;
      const cost = h.avgCostPerShare * h.shares;
      const loss = cost - h.value;
      if (cost <= 0 || loss < TAX_LOSS_HARVEST.minLossShare * cost) continue;
      out.push({
        simplefinAccountId: a.simplefinAccountId,
        accountLabel: a.label,
        fund: h.symbol ?? h.name,
        loss,
      });
    }
  }
  return out;
}

export type CheaperFundFinding = {
  simplefinAccountId: number;
  accountLabel: string;
  securityId: number;
  fund: string;
  expenseRatio: number;
  proxyLabel: string;
  /** Yearly fees above the low-cost line on today's value. */
  yearlySaving: number;
};

/** The bucket a fund is (nearly) all in, or null for a mixed fund. */
function singleClass(facts: EffectiveFacts): CompositionBucket | null {
  const c = facts.composition;
  if (!c || c.coverage <= 0) return null;
  for (const b of COMPOSITION_BUCKET_VALUES)
    if (c.buckets[b] >= CHEAPER_FUND.singleClassMinShare) return b;
  return null;
}

export function judgeCheaperFunds(
  accounts: readonly FundAccountInput[],
): CheaperFundFinding[] {
  const out: CheaperFundFinding[] = [];
  for (const a of accounts) {
    const switchable =
      a.accountType !== null &&
      (isIraCategory(a.accountType) || isTaxableAccountType(a.accountType));
    if (!switchable) continue;
    for (const h of a.holdings) {
      const er = h.facts.expenseRatio?.value ?? null;
      if (er === null) continue;
      const gap = er - LOW_COST_EXPENSE_RATIO;
      if (gap < CHEAPER_FUND.minExpenseGap) continue;
      const bucket = singleClass(h.facts);
      const proxy = bucket ? BUCKET_INDEX_PROXIES[bucket] : null;
      if (!proxy) continue;
      out.push({
        simplefinAccountId: a.simplefinAccountId,
        accountLabel: a.label,
        securityId: h.securityId,
        fund: h.symbol ?? h.name,
        expenseRatio: er,
        proxyLabel: proxy.label,
        yearlySaving: h.value * gap,
      });
    }
  }
  return out;
}
