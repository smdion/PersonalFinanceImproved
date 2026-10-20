import { describe, it, expect } from "vitest";
import {
  currentCashClass,
  hsaCashBuffers,
  resolveHsaCashBuffer,
  judgeCashDrag,
  judgeHsaCash,
  type CashAccountInput,
} from "@/lib/pure/cash-positions";
import { recommendationsFromCash } from "@/lib/pure/recommendations-cash";
import type { CompositionBucket } from "@/lib/config/enum-values";
import type { ValuedHolding } from "@/lib/pure/fund-facts";

const mix = (over: Partial<Record<CompositionBucket, number>>) => ({
  us_equity: 0,
  intl_equity: 0,
  us_bond: 0,
  intl_bond: 0,
  tips: 0,
  cash: 0,
  other: 0,
  ...over,
});
const fund = (
  value: number,
  buckets: Partial<Record<CompositionBucket, number>>,
): ValuedHolding => ({
  value,
  facts: {
    expenseRatio: null,
    composition: {
      buckets: mix(buckets),
      coverage: 1,
      asOf: "2026-01-01",
      fromUser: false,
    },
    stale: false,
  },
});
const account = (over: Partial<CashAccountInput>): CashAccountInput => ({
  simplefinAccountId: 1,
  label: "Brokerage",
  accountType: "brokerage",
  taxType: null,
  ownerPersonId: 1,
  holdings: [],
  uninvestedCash: null,
  ...over,
});
const cashClass = {
  targetShare: 0.02,
  buckets: ["cash"] as CompositionBucket[],
};

describe("judgeCashDrag", () => {
  it("flags cash past the band, sized to the target", () => {
    const f = judgeCashDrag({
      accounts: [
        account({
          holdings: [fund(90_000, { us_equity: 1 }), fund(5_000, { cash: 1 })],
          uninvestedCash: 5_000,
        }),
      ],
      cashClass,
      excludeTraditionalIra: false,
    });
    // 10k of 100k = 10% vs 2% target → 8k to invest.
    expect(f).toHaveLength(1);
    expect(f[0]!.excess).toBeCloseTo(8_000, 2);
  });

  it("inside the band, no current glide path, or an HSA: nothing", () => {
    const within = account({
      holdings: [fund(95_000, { us_equity: 1 }), fund(5_000, { cash: 1 })],
    }); // 5% vs 2%: 3 points, under the 5-point band
    expect(
      judgeCashDrag({
        accounts: [within],
        cashClass,
        excludeTraditionalIra: false,
      }),
    ).toEqual([]);
    const heavy = account({ holdings: [fund(50_000, { cash: 1 })] });
    expect(
      judgeCashDrag({
        accounts: [heavy],
        cashClass: null,
        excludeTraditionalIra: false,
      }),
    ).toEqual([]);
    expect(
      judgeCashDrag({
        accounts: [
          account({
            accountType: "hsa",
            holdings: [fund(50_000, { cash: 1 })],
          }),
        ],
        cashClass,
        excludeTraditionalIra: false,
      }),
    ).toEqual([]);
  });

  it("a traditional IRA is skipped only while a backdoor is the plan", () => {
    const ira = account({
      accountType: "ira",
      taxType: "preTax",
      holdings: [fund(7_000, { cash: 1 })],
    });
    expect(
      judgeCashDrag({
        accounts: [ira],
        cashClass,
        excludeTraditionalIra: true,
      }),
    ).toEqual([]);
    expect(
      judgeCashDrag({
        accounts: [ira],
        cashClass,
        excludeTraditionalIra: false,
      }),
    ).toHaveLength(1);
  });
});

describe("judgeCashDrag — whole-account IRA link", () => {
  it("an IRA with no tax type (whole-account link) is skipped while a backdoor is the plan", () => {
    const ira = account({
      accountType: "ira",
      taxType: null,
      holdings: [fund(7_000, { cash: 1 })],
    });
    expect(
      judgeCashDrag({
        accounts: [ira],
        cashClass,
        excludeTraditionalIra: true,
      }),
    ).toEqual([]);
  });
});

describe("hsaCashBuffers", () => {
  it("the HDHP minimum deductible for the coverage; unknown coverage → null", () => {
    expect(
      hsaCashBuffers({
        people: [
          { personId: 1, hsaCoverageType: "family" },
          { personId: 2, hsaCoverageType: "self_only" },
          { personId: 3, hsaCoverageType: null },
        ],
        limits: {
          hdhp_min_deductible_self: 1500,
          hdhp_min_deductible_family: 3000,
        },
      }),
    ).toEqual([
      { personId: 1, buffer: 3000 },
      { personId: 2, buffer: 1500 },
      { personId: 3, buffer: null },
    ]);
  });
});

describe("judgeHsaCash", () => {
  const hsa = account({
    accountType: "hsa",
    ownerPersonId: 1,
    holdings: [fund(4_000, { us_equity: 1 })],
    uninvestedCash: 6_000,
  });
  it("cash above the owner's deductible buffer", () => {
    const f = judgeHsaCash({
      accounts: [hsa],
      bufferSetting: null,
      defaultBuffers: [{ personId: 1, buffer: 3_000 }],
    });
    expect(f).toEqual([
      expect.objectContaining({ excess: 3_000, buffer: 3_000, value: 10_000 }),
    ]);
  });

  it("the household setting wins; no coverage and no setting → nothing", () => {
    expect(
      judgeHsaCash({
        accounts: [hsa],
        bufferSetting: 5_500,
        defaultBuffers: [],
      })[0]!.excess,
    ).toBe(500);
    expect(
      judgeHsaCash({
        accounts: [hsa],
        bufferSetting: null,
        defaultBuffers: [{ personId: 1, buffer: null }],
      }),
    ).toEqual([]);
  });
});

describe("recommendationsFromCash", () => {
  it("maps findings to investing items with one-time dollars", () => {
    const r = recommendationsFromCash({
      drag: [
        {
          simplefinAccountId: 4,
          label: "Taxable",
          excess: 8000,
          value: 100000,
        },
      ],
      hsa: [
        {
          simplefinAccountId: 5,
          label: "HSA",
          excess: 3000,
          value: 10000,
          buffer: 3000,
        },
      ],
    });
    expect(r.map((x) => [x.id, x.area, x.impact])).toEqual([
      ["cashDrag:4", "investing", { kind: "oneTime", amount: 8000 }],
      ["hsaCash:5", "investing", { kind: "oneTime", amount: 3000 }],
    ]);
  });
});

describe("resolveHsaCashBuffer / currentCashClass", () => {
  it("the setting wins, else the owner's default, else unknown", () => {
    const d = [{ personId: 1, buffer: 3000 }];
    expect(resolveHsaCashBuffer(500, d, 1)).toBe(500);
    expect(resolveHsaCashBuffer(null, d, 1)).toBe(3000);
    expect(resolveHsaCashBuffer(null, d, 2)).toBeNull();
    expect(resolveHsaCashBuffer(null, d, null)).toBeNull();
  });
  it("the cash class only from the household's current glide path", () => {
    const overview = (targetSource: string) => ({
      targetSource,
      allocation: {
        categories: [{ bucket: "cash" as const, assetClassId: 9 }],
        rows: [
          { assetClassId: 9, buckets: ["cash" as const], targetPct: 0.03 },
        ],
      },
    });
    expect(currentCashClass(overview("current"))).toEqual({
      targetShare: 0.03,
      buckets: ["cash"],
    });
    expect(currentCashClass(overview("retirement"))).toBeNull();
  });
});
