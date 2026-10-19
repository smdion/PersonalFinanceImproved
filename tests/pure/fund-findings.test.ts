import { describe, it, expect } from "vitest";
import {
  judgeCheaperFunds,
  judgeTaxLossHarvest,
  type FundAccountInput,
} from "@/lib/pure/fund-findings";
import { recommendationsFromFunds } from "@/lib/pure/recommendations-funds";
import { LOW_COST_EXPENSE_RATIO } from "@/lib/config/milestones";
import type { CompositionBucket } from "@/lib/config/enum-values";
import type { EffectiveFacts } from "@/lib/pure/fund-facts";

const facts = (
  er: number | null,
  buckets: Partial<Record<CompositionBucket, number>> | null,
): EffectiveFacts => ({
  expenseRatio:
    er === null ? null : { value: er, asOf: "2026-01-01", fromUser: false },
  composition: buckets
    ? {
        buckets: {
          us_equity: 0,
          intl_equity: 0,
          us_bond: 0,
          intl_bond: 0,
          tips: 0,
          cash: 0,
          other: 0,
          ...buckets,
        },
        coverage: 1,
        asOf: "2026-01-01",
        fromUser: false,
      }
    : null,
  stale: false,
});
const holding = (over: Partial<FundAccountInput["holdings"][number]>) => ({
  securityId: 1,
  name: "Example Fund",
  symbol: "EXFX",
  shares: 100,
  value: 10_000,
  avgCostPerShare: null,
  facts: facts(null, null),
  ...over,
});
const account = (
  accountType: string,
  holdings: FundAccountInput["holdings"],
) => ({
  simplefinAccountId: 9,
  label: "Account",
  accountType,
  holdings,
});

describe("judgeTaxLossHarvest", () => {
  it("taxable positions well below average cost; not tax-deferred, not tiny, not without cost", () => {
    const losing = holding({ avgCostPerShare: 120 }); // cost 12,000 vs 10,000
    const small = holding({ securityId: 2, avgCostPerShare: 102 }); // 2% down
    const unknown = holding({ securityId: 3 });
    expect(
      judgeTaxLossHarvest([account("brokerage", [losing, small, unknown])]),
    ).toEqual([
      {
        simplefinAccountId: 9,
        accountLabel: "Account",
        fund: "EXFX",
        loss: 2_000,
      },
    ]);
    expect(judgeTaxLossHarvest([account("ira", [losing])])).toEqual([]);
  });
});

describe("judgeCheaperFunds", () => {
  const pricey = holding({
    facts: facts(0.008, { us_equity: 0.98, cash: 0.02 }),
  });
  it("a single-class, high-fee fund in an IRA or taxable account; saving to the low-cost line", () => {
    const [f] = judgeCheaperFunds([account("ira", [pricey])]);
    expect(f!.proxyLabel).toMatch(/VTI/);
    expect(f!.yearlySaving).toBeCloseTo(
      10_000 * (0.008 - LOW_COST_EXPENSE_RATIO),
      6,
    );
  });
  it("not in a 401(k) or HSA, not a balanced fund, not a cheap fund", () => {
    expect(judgeCheaperFunds([account("401k", [pricey])])).toEqual([]);
    expect(judgeCheaperFunds([account("hsa", [pricey])])).toEqual([]);
    const balanced = holding({
      facts: facts(0.008, { us_equity: 0.6, us_bond: 0.4 }),
    });
    const cheap = holding({ facts: facts(0.0005, { us_equity: 1 }) });
    expect(
      judgeCheaperFunds([account("brokerage", [balanced, cheap])]),
    ).toEqual([]);
  });
});

describe("recommendationsFromFunds", () => {
  it("one harvest item per account, one cheaper-fund item per fund", () => {
    const r = recommendationsFromFunds({
      harvest: [
        {
          simplefinAccountId: 1,
          accountLabel: "Taxable",
          fund: "A",
          loss: 500,
        },
        {
          simplefinAccountId: 1,
          accountLabel: "Taxable",
          fund: "B",
          loss: 250,
        },
      ],
      cheaper: [
        {
          simplefinAccountId: 2,
          accountLabel: "IRA",
          securityId: 7,
          fund: "C",
          expenseRatio: 0.008,
          proxyLabel: "Total US stock market (VTI)",
          yearlySaving: 60,
        },
      ],
    });
    expect(r.map((x) => [x.id, x.impact])).toEqual([
      ["harvest:1", { kind: "oneTime", amount: 750 }],
      ["cheaperFund:2:7", { kind: "perYear", amount: 60 }],
    ]);
    expect(r[0]!.context).toMatch(/Wash-sale/);
  });
});
