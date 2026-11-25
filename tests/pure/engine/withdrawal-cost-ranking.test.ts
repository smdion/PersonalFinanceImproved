import { describe, it, expect } from "vitest";
import {
  deriveBasisRankingInputs,
  drawByMarginalCost,
  freeDrawCapacities,
  walkDiscretionaryDraw,
  type DrawSegment,
} from "@/lib/pure/engine/withdrawal-cost-ranking";
import type { DrawSources, DrawState } from "@/lib/pure/engine/draw-position";
import { computeTaxableSS } from "@/lib/pure/engine/tax-estimation";
import type { RothBasisState } from "@/lib/pure/accounts/roth-basis-tracking";

function rothState(
  contributionBasis: number,
  conversionBasis = 0,
): RothBasisState {
  return {
    contributionBasis,
    conversionBasis,
    latestConversionYear: null,
    sourceYear: null,
    isSeeded: false,
    stale: false,
  };
}

// The 2025 rate schedule for married filing jointly, Rev. Proc. 2024-40
// § 2.01 Table 1 (taxable income over / tax on that / rate on the
// excess), as `WithholdingBracket` rows. No standard deduction is passed,
// so `ordinaryIncome` reads as taxable income.
const MFJ_BRACKETS = [
  { threshold: 0, baseWithholding: 0, rate: 0.1 },
  { threshold: 23850, baseWithholding: 2385, rate: 0.12 },
  { threshold: 96950, baseWithholding: 11157, rate: 0.22 },
  { threshold: 206700, baseWithholding: 35302, rate: 0.24 },
  { threshold: 394600, baseWithholding: 80398, rate: 0.32 },
  { threshold: 501050, baseWithholding: 114462, rate: 0.35 },
  { threshold: 751600, baseWithholding: 202154.5, rate: 0.37 },
];
/** MFJ gains brackets (Rev. Proc. 2025-32 § 4.03): 0% to 98,900, 15% to
 *  613,700, then 20%. */
const LTCG = {
  MFJ: [
    { threshold: 98900, rate: 0 },
    { threshold: 613700, rate: 0.15 },
    { threshold: null, rate: 0.2 },
  ],
};

function state(overrides: Partial<DrawState> = {}): DrawState {
  return {
    filingStatus: "MFJ",
    ordinaryIncome: 50000,
    gains: 0,
    magi: overrides.ordinaryIncome ?? 50000,
    taxBrackets: MFJ_BRACKETS,
    ltcgBrackets: LTCG,
    brokerageBasisRatio: 0,
    rothProRataTaxableShare: 0,
    ...overrides,
  };
}
const sources = (s: Partial<DrawSources>): DrawSources => ({
  rothBasis: 0,
  rothGrowth: 0,
  rothProRata: 0,
  brokerage: 0,
  hsa: 0,
  ...s,
});
/** [part, amount to the cent, marginal cost to 1e-9, NIIT]. */
const of = (segments: DrawSegment[]) =>
  segments.map((s) => [
    s.part,
    Math.round(s.amount * 100) / 100,
    Math.round(s.marginalCost * 1e9) / 1e9,
    !!s.includesNiit,
  ]);

describe("walkDiscretionaryDraw: each dollar from the source whose next dollar costs least", () => {
  it("an HSA dollar that pushes taxed gains from 0% to 15% costs 10% + 15%, so a 94%-gain brokerage dollar (≈ 14.1%) goes first", () => {
    // Ordinary 20,000 (10% bracket); 100,000 of gains already stacked on it,
    // their top at 120,000 in the 15% bracket, their bottom in the 0% one.
    const segments = walkDiscretionaryDraw(
      state({
        ordinaryIncome: 20000,
        gains: 100000,
        magi: 120000,
        brokerageBasisRatio: 0.06,
      }),
      sources({ hsa: 50000, brokerage: 50000 }),
      10000,
    );
    expect(of(segments)).toEqual([["brokerage", 10000, 0.141, false]]);
  });

  it("stops at an ordinary edge and goes on at the next bracket's rate", () => {
    const segments = walkDiscretionaryDraw(
      state({ ordinaryIncome: 20000 }),
      sources({ hsa: 50000 }),
      10000,
    );
    expect(of(segments)).toEqual([
      ["hsa", 3850, 0.1, false],
      ["hsa", 6150, 0.12, false],
    ]);
  });

  it("stops where the gains' top reaches an LTCG edge", () => {
    const segments = walkDiscretionaryDraw(
      state(),
      sources({ brokerage: 100000 }),
      60000,
    );
    expect(of(segments)).toEqual([
      ["brokerage", 48900, 0, false],
      ["brokerage", 11100, 0.15, false],
    ]);
  });

  it("stops where ordinary income lifts the gains' bottom across an LTCG edge", () => {
    // Ordinary 90,000 under 20,000 of gains: an HSA dollar costs 12% and moves
    // a gains dollar from 0% to 15% (27%); past 96,950 it pays 22% + 15%;
    // once the bottom passes 98,900 it moves 15% gains to 15% (22%).
    const segments = walkDiscretionaryDraw(
      state({ ordinaryIncome: 90000, gains: 20000, magi: 110000 }),
      sources({ hsa: 50000 }),
      10000,
    );
    expect(of(segments)).toEqual([
      ["hsa", 6950, 0.27, false],
      ["hsa", 1950, 0.37, false],
      ["hsa", 1100, 0.22, false],
    ]);
  });

  it("stops at the NIIT threshold: brokerage gains past it pay 3.8% more", () => {
    const segments = walkDiscretionaryDraw(
      state({ ordinaryIncome: 240000 }),
      sources({ brokerage: 100000 }),
      20000,
    );
    expect(of(segments)).toEqual([
      ["brokerage", 10000, 0.15, false],
      ["brokerage", 10000, 0.15 + 0.038, true],
    ]);
  });

  it("gains fill the unused deduction at 0%, then the 0% bracket, then pay 15%", () => {
    const segments = walkDiscretionaryDraw(
      state({ ordinaryIncome: 20000, standardDeduction: 30000 }),
      sources({ brokerage: 200000 }),
      120000,
    );
    expect(of(segments)).toEqual([
      ["brokerage", 108900, 0, false],
      ["brokerage", 11100, 0.15, false],
    ]);
  });

  it("goes on to the next source when one runs out, and stops at the need", () => {
    const segments = walkDiscretionaryDraw(
      state(),
      sources({ rothBasis: 5000, hsa: 10000 }),
      8000,
    );
    expect(of(segments)).toEqual([
      ["rothBasis", 5000, 0, false],
      ["hsa", 3000, 0.12, false],
    ]);
  });

  it("the brokerage dollars past the 0% top pay 15% when the stack lands one ulp under it", () => {
    const T0 = 99405.91325738844;
    const a = 24873.43; // a + (T0 − a) is one ulp below T0
    expect(a + (T0 - a) < T0).toBe(true);
    const segments = walkDiscretionaryDraw(
      state({
        ordinaryIncome: a,
        ltcgBrackets: {
          MFJ: [
            { threshold: T0, rate: 0 },
            { threshold: 613700, rate: 0.15 },
            { threshold: null, rate: 0.2 },
          ],
        },
      }),
      sources({ brokerage: 200000 }),
      200000,
    );
    expect(of(segments)).toEqual([
      ["brokerage", 74532.48, 0, false],
      ["brokerage", 125467.52, 0.15, false],
    ]);
  });

  it("a floor $0.001 under an edge is on it: no sub-cent stretch at the lower rate", () => {
    const segments = walkDiscretionaryDraw(
      state({ ordinaryIncome: 96949.999 }),
      sources({ hsa: 10000 }),
      10000,
    );
    expect(of(segments)).toEqual([["hsa", 10000, 0.22, false]]);
  });

  it("a floor equal to a grown edge in cents, though not as floats, starts in the bracket above", () => {
    // A grown 22% edge at 96,950.004; the Traditional cap rounds the floor
    // to it in cents: 96,950.00, under the edge as a float.
    const grown = MFJ_BRACKETS.map((b) =>
      b.rate === 0.22 ? { ...b, threshold: 96950.004 } : b,
    );
    expect(96950 < 96950.004).toBe(true);
    const segments = walkDiscretionaryDraw(
      state({ ordinaryIncome: 96950, taxBrackets: grown }),
      sources({ hsa: 10000 }),
      10000,
    );
    expect(of(segments)).toEqual([["hsa", 10000, 0.22, false]]);
  });

  it("Roth growth and the HSA share a bracket's room, Roth first", () => {
    const segments = walkDiscretionaryDraw(
      state({ ordinaryIncome: 90000 }),
      sources({ rothGrowth: 5000, hsa: 5000 }),
      10000,
    );
    expect(of(segments)).toEqual([
      ["rothGrowth", 5000, 0.12, false],
      ["hsa", 1950, 0.12, false],
      ["hsa", 3050, 0.22, false],
    ]);
  });

  describe("ties", () => {
    it("free sources go by discretionaryWithdrawalOrder", () => {
      const both = sources({ rothBasis: 5000, brokerage: 5000 });
      const parts = (order?: "roth_first" | "brokerage_first") =>
        walkDiscretionaryDraw(
          state({ discretionaryWithdrawalOrder: order }),
          both,
          10000,
        ).map((s) => s.part);
      expect(parts()).toEqual(["rothBasis", "brokerage"]);
      expect(parts("roth_first")).toEqual(["rothBasis", "brokerage"]);
      expect(parts("brokerage_first")).toEqual(["brokerage", "rothBasis"]);
    });

    it("priced sources at one cost go Roth growth, brokerage, then HSA", () => {
      // No 0% bracket and a 12% gains rate: an all-gain brokerage dollar
      // costs 12%, the ordinary rate at 50,000.
      const segments = walkDiscretionaryDraw(
        state({
          ltcgBrackets: {
            MFJ: [
              { threshold: 613700, rate: 0.12 },
              { threshold: null, rate: 0.2 },
            ],
          },
        }),
        sources({ rothGrowth: 1000, brokerage: 1000, hsa: 1000 }),
        2500,
      );
      expect(segments.map((s) => [s.part, s.amount])).toEqual([
        ["rothGrowth", 1000],
        ["brokerage", 1000],
        ["hsa", 500],
      ]);
    });
  });

  it("with no ceiling on the floor (a conversion reserving the open top bracket) every source stays, at the top rates, all finite", () => {
    const segments = walkDiscretionaryDraw(
      state({ ordinaryIncome: Infinity, magi: Infinity }),
      sources({ rothGrowth: 50000, brokerage: Infinity, hsa: 10000 }),
      100000,
    );
    expect(of(segments)).toEqual([["brokerage", 100000, 0.238, true]]);
    const rest = walkDiscretionaryDraw(
      state({ ordinaryIncome: Infinity, magi: Infinity }),
      sources({ rothGrowth: 50000, hsa: 10000 }),
      100000,
    );
    expect(of(rest)).toEqual([
      ["rothGrowth", 50000, 0.37, false],
      ["hsa", 10000, 0.37, false],
    ]);
    for (const s of [...segments, ...rest]) {
      expect(Number.isFinite(s.amount)).toBe(true);
      expect(Number.isFinite(s.marginalCost)).toBe(true);
    }
  });

  it("without a filing status brokerage comes last", () => {
    const segments = walkDiscretionaryDraw(
      state({ filingStatus: undefined }),
      sources({ brokerage: 5000, hsa: 5000 }),
      8000,
    );
    expect(segments.map((s) => [s.part, s.amount])).toEqual([
      ["hsa", 5000],
      ["brokerage", 3000],
    ]);
  });

  it("the segments add up to the need", () => {
    const segments = walkDiscretionaryDraw(
      state({ ordinaryIncome: 60000, gains: 30000, magi: 245000 }),
      sources({
        rothBasis: 3000,
        rothGrowth: 40000,
        brokerage: 300000,
        hsa: 80000,
      }),
      250000.37,
    );
    const total = segments.reduce((s, x) => s + x.amount, 0);
    expect(total).toBeCloseTo(250000.37, 6);
  });
});

/** Benefits of `gross` beside `other` income (MFJ: Pub 915's 32,000/44,000):
 *  the walk's start with the taxable share already in ordinary income. */
const withBenefits = (gross: number, other: number) =>
  state({
    ordinaryIncome: other + computeTaxableSS(gross, other, "MFJ"),
    magi: other + computeTaxableSS(gross, other, "MFJ"),
    socialSecurity: { gross, provisionalIncome: other + gross / 2 },
  });

describe("walkDiscretionaryDraw: the Social Security each dollar makes taxable", () => {
  it("under the first threshold a dollar costs its rate; past it, 1.5 times the rate", () => {
    // 20,000 of benefits beside 20,000: provisional income 30,000, nothing taxable.
    // 2,000 reaches 32,000; then each dollar adds 1.50 of income until the 12%
    // edge (23,850: 1,850 / 1.5 = 1,233.33), then 1.5 × 12%.
    const segments = walkDiscretionaryDraw(
      withBenefits(20000, 20000),
      sources({ hsa: 50000 }),
      4000,
    );
    expect(of(segments)).toEqual([
      ["hsa", 2000, 0.1, false],
      ["hsa", 1233.33, 0.15, false],
      ["hsa", 766.67, 0.18, false],
    ]);
    // Income 20,000 → 25,000 (1,000 of it benefits): 385 + 138 = 523 of tax.
    const tax = segments.reduce((s, x) => s + x.amount * x.marginalCost, 0);
    expect(tax).toBeCloseTo(523, 6);
  });

  it("over the second threshold a dollar costs 1.85 times its rate, up to the 85% cap", () => {
    // 30,000 of benefits beside 40,000: provisional 55,000, taxable 15,350.
    // The cap (25,500 taxable) is at provisional 44,000 + 19,500 / 0.85 =
    // 66,941.18: 11,941.18 dollars at 1.85 × 12%, then 12%.
    const segments = walkDiscretionaryDraw(
      withBenefits(30000, 40000),
      sources({ hsa: 50000 }),
      15000,
    );
    expect(of(segments)).toEqual([
      ["hsa", 11941.18, 0.222, false],
      ["hsa", 3058.82, 0.12, false],
    ]);
  });

  it("a brokerage gain in the 0% band still costs the benefits it makes taxable", () => {
    // 20,000 of benefits beside 30,000: provisional 40,000, income 34,000 (12%).
    // An all-gain dollar is 0% gains but 0.5 of a dollar of taxable benefits
    // (6%) to provisional 44,000, then 0.85 (10.2%).
    const segments = walkDiscretionaryDraw(
      withBenefits(20000, 30000),
      sources({ brokerage: 50000, hsa: 50000 }),
      5000,
    );
    expect(of(segments)).toEqual([
      ["brokerage", 4000, 0.06, false],
      ["brokerage", 1000, 0.102, false],
    ]);
  });

  it("without a filing status the benefits aren't priced", () => {
    const segments = walkDiscretionaryDraw(
      { ...withBenefits(20000, 20000), filingStatus: undefined },
      sources({ hsa: 50000 }),
      3000,
    );
    expect(of(segments)).toEqual([["hsa", 3000, 0.1, false]]);
  });
});

describe("walkDiscretionaryDraw: a hand-edited bracket table", () => {
  // Settings › Tax brackets accepts rows in any order and rates that fall.
  const falling = [
    { threshold: 0, baseWithholding: 0, rate: 0 },
    { threshold: 30000, baseWithholding: 0, rate: 0.3 },
    { threshold: 50000, baseWithholding: 6000, rate: 0.2 },
    { threshold: 130000, baseWithholding: 22000, rate: 0.4 },
  ];
  const unsorted = [
    { threshold: 30000, baseWithholding: 0, rate: 0.1 },
    { threshold: 0, baseWithholding: 0, rate: 0 },
    { threshold: 130000, baseWithholding: 11540, rate: 0.22 },
  ];
  const walk = (overrides: Partial<DrawState>) =>
    walkDiscretionaryDraw(
      state({
        ordinaryIncome: 60000,
        magi: 60000,
        standardDeduction: 30000,
        brokerageBasisRatio: 0.5,
        ...overrides,
      }),
      sources({ rothGrowth: 50000, hsa: 20000 }),
      40000,
    );
  const drawsAll = (segments: ReturnType<typeof walk>) => {
    for (const s of segments) {
      expect(Number.isFinite(s.amount) && s.amount > 0).toBe(true);
      expect(Number.isFinite(s.marginalCost)).toBe(true);
    }
    expect(segments.reduce((sum, s) => sum + s.amount, 0)).toBeCloseTo(
      40000,
      2,
    );
  };

  it("draws the need from a table whose rates fall", () => {
    drawsAll(walk({ taxBrackets: falling }));
  });

  it("draws the need from a table whose rows are out of order", () => {
    drawsAll(walk({ taxBrackets: unsorted }));
  });

  it("draws the need from a falling-rate table with Social Security", () => {
    drawsAll(
      walk({
        taxBrackets: falling,
        socialSecurity: { gross: 40000, provisionalIncome: 50000 },
      }),
    );
  });
});

describe("walkDiscretionaryDraw: a pro_rata Roth 401(k)", () => {
  it("costs its taxable share of the ordinary rate, and reaches the edge at that share", () => {
    // 40% of each dollar is taxed growth: 4.8% in the 12% bracket; the 22%
    // edge 1,950 away is 4,875 dollars away; then 8.8%.
    const segments = walkDiscretionaryDraw(
      state({ ordinaryIncome: 95000, rothProRataTaxableShare: 0.4 }),
      sources({ rothProRata: 10000, hsa: 10000 }),
      6000,
    );
    expect(of(segments)).toEqual([
      ["rothProRata", 4875, 0.048, false],
      ["rothProRata", 1125, 0.088, false],
    ]);
  });

  it("with no taxed growth it is free, after Roth basis and before brokerage", () => {
    const segments = walkDiscretionaryDraw(
      state({ ordinaryIncome: 20000 }),
      sources({ rothBasis: 1000, rothProRata: 1000, brokerage: 1000 }),
      3000,
    );
    expect(of(segments)).toEqual([
      ["rothBasis", 1000, 0, false],
      ["rothProRata", 1000, 0, false],
      ["brokerage", 1000, 0, false],
    ]);
  });
});

describe("drawByMarginalCost", () => {
  it("a source drawn short of its segment is closed, and the rest is walked again", () => {
    const asked: string[] = [];
    const out = drawByMarginalCost(
      state(),
      sources({ hsa: 10000, brokerage: 100000 }),
      60000,
      (segment) => {
        asked.push(`${segment.part} ${Math.round(segment.amount)}`);
        // the brokerage can give only 30,000 (an account cap)
        return segment.part === "brokerage"
          ? Math.min(segment.amount, 30000)
          : segment.amount;
      },
    );
    expect(asked).toEqual(["brokerage 48900", "hsa 10000"]);
    expect(out.map((s) => [s.part, Math.round(s.drawn)])).toEqual([
      ["brokerage", 30000],
      ["hsa", 10000],
    ]);
  });
});

describe("freeDrawCapacities", () => {
  it("brokerage's free room is the unused deduction plus the 0% bracket, in withdrawal dollars", () => {
    expect(
      freeDrawCapacities(
        state({
          ordinaryIncome: 20000,
          standardDeduction: 30000,
          brokerageBasisRatio: 0.5,
        }),
        sources({ rothBasis: 4000, brokerage: 1_000_000 }),
      ),
    ).toEqual({ rothBasisCapacity: 4000, brokerageZeroLtcgCapacity: 217800 });
  });

  it("brokerage's free room is 0 without a filing status", () => {
    expect(
      freeDrawCapacities(
        state({ filingStatus: null }),
        sources({ brokerage: 5000 }),
      ).brokerageZeroLtcgCapacity,
    ).toBe(0);
  });
});

// A Portfolio-parented Roth
// account's basis is unconditionally excluded from the routable pool,
// but deriveBasisRankingInputs used to sum indBasis across every
// tracked account regardless -- overstating rothBasisAvailable exactly for
// a household whose basis happens to sit in an excluded account.
describe("deriveBasisRankingInputs", () => {
  const balances = { afterTax: 0, afterTaxBasis: 0 };

  it("sums basis across all tracked Roth accounts when no indAccts/indKey given (legacy behavior, no individual-account tracking)", () => {
    const indBasis = new Map([
      ["a", rothState(10000)],
      ["b", rothState(5000, 2000)],
    ]);
    const result = deriveBasisRankingInputs({ balances, indBasis });
    expect(result.rothBasisAvailable).toBe(17000);
  });

  it("excludes a Portfolio-parented Roth account's basis from the routable total", () => {
    const indAccounts = [
      {
        name: "Retirement Roth",
        category: "ira" as const,
        taxType: "taxFree",
        parentCategory: "Retirement",
      },
      {
        name: "Brokerage-parked Roth",
        category: "ira" as const,
        taxType: "taxFree",
        parentCategory: "Portfolio",
      },
    ];
    const indKey = (ia: { name: string }) => ia.name;
    const indBasis = new Map([
      ["Retirement Roth", rothState(10000)],
      // All the household's basis happens to sit in the excluded account.
      ["Brokerage-parked Roth", rothState(40000)],
    ]);
    const result = deriveBasisRankingInputs({
      balances,
      indBasis,
      indAccounts,
      indKey,
    });
    // Only the Retirement-parented account's basis counts -- the
    // Portfolio-parented $40,000 is structurally unreachable by routing.
    expect(result.rothBasisAvailable).toBe(10000);
  });

  it("excludes non-Roth accounts from the basis total even when indAccts/indKey are given", () => {
    const indAccounts = [
      {
        name: "Traditional 401k",
        category: "401k" as const,
        taxType: "preTax",
        parentCategory: "Retirement",
      },
    ];
    const indKey = (ia: { name: string }) => ia.name;
    // A traditional account has no Roth "basis" concept -- even if a
    // caller mistakenly seeded an indBasis entry for it, it must not leak
    // into rothBasisAvailable.
    const indBasis = new Map([["Traditional 401k", rothState(9999)]]);
    const result = deriveBasisRankingInputs({
      balances,
      indBasis,
      indAccounts,
      indKey,
    });
    expect(result.rothBasisAvailable).toBe(0);
  });

  it("keeps a pro_rata Roth 401(k) out of the free basis: its balance, unqualified basis and qualified balance", () => {
    const account = (name: string, category: "401k" | "ira", born: number) => ({
      name,
      category,
      taxType: "taxFree",
      parentCategory: "Retirement",
      ownerBirthYear: born,
    });
    const result = deriveBasisRankingInputs({
      balances,
      indBasis: new Map([
        ["young 401k", rothState(30000, 5000)],
        ["old 401k", rothState(20000)],
        ["young IRA", rothState(7000)],
      ]),
      indAccounts: [
        account("young 401k", "401k", 1980),
        account("old 401k", "401k", 1960),
        account("young IRA", "ira", 1980),
      ],
      indKey: (ia) => ia.name,
      indBalance: new Map([
        ["young 401k", 100000],
        ["old 401k", 60000],
        ["young IRA", 9000],
      ]),
      year: 2026,
    });
    expect(result.rothProRata).toEqual({
      balance: 160000,
      basis: 35000,
      qualifiedBalance: 60000,
    });
    expect(result.rothBasisAvailable).toBe(7000);
  });

  it("regression guard: without indAccts/indKey, the excluded account's basis wrongly leaks back in", () => {
    // Same setup as the Portfolio-parented test above, but calling the
    // legacy (no exclusion awareness) code path -- proves the fix above
    // actually changes behavior rather than being a no-op.
    const indBasis = new Map([
      ["Retirement Roth", rothState(10000)],
      ["Brokerage-parked Roth", rothState(40000)],
    ]);
    const result = deriveBasisRankingInputs({ balances, indBasis });
    expect(result.rothBasisAvailable).toBe(50000);
  });
});
