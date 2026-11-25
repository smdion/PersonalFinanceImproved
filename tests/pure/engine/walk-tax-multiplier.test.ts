/**
 * The withdrawal walk under the tax multiplier (D12.16, OD-3 Rec (a): the
 * ranking uses the scaled rates). Settlement (`computeTaxFromSlots`) scales
 * ordinary and gains tax by the multiplier, caps ordinary tax at 50% of
 * gross income, and leaves the NIIT unscaled; the walk prices each dollar
 * the same way, so its predicted tax matches settlement's within $1 (BF1's
 * pricing-consistency check, here at multipliers other than 1).
 */
import { describe, expect, it } from "vitest";
import { walkDiscretionaryDraw } from "@/lib/pure/engine/withdrawal-cost-ranking";
import type { DrawSources, DrawState } from "@/lib/pure/engine/draw-position";
import {
  computeTaxableSS,
  computeTaxFromSlots,
  type WithholdingBracket,
} from "@/lib/pure/engine/tax-estimation";
import { computeNiit } from "@/lib/pure/tax/niit";
import type { DecumulationSlot } from "@/lib/pure/engine/types";
import { readTaxData, shippedTaxTables } from "../../helpers/tax-data";

const MFJ_2026 = readTaxData().years["2026"]!.withholding.tables["MFJ"]!
  .standard as WithholdingBracket[];
const LTCG_2026 = shippedTaxTables(2026).ltcgBrackets;
const STD_MFJ_2026 = 32_200;

type Start = {
  multiplier: number;
  /** Traditional (and other non-benefit ordinary income) before the draw. */
  traditional: number;
  socialSecurity?: number;
  basisRatio: number;
};

function startState(s: Start): DrawState {
  const ss = s.socialSecurity ?? 0;
  const taxableSS = ss > 0 ? computeTaxableSS(ss, s.traditional, "MFJ") : 0;
  return {
    filingStatus: "MFJ",
    ordinaryIncome: s.traditional + taxableSS,
    gains: 0,
    magi: s.traditional + taxableSS,
    taxBrackets: MFJ_2026,
    ltcgBrackets: LTCG_2026,
    standardDeduction: STD_MFJ_2026,
    brokerageBasisRatio: s.basisRatio,
    rothProRataTaxableShare: 0,
    taxMultiplier: s.multiplier,
    ...(ss > 0 && {
      socialSecurity: { gross: ss, provisionalIncome: s.traditional + ss / 2 },
    }),
  };
}

/** Settlement's tax and NIIT with every taxed dollar a Traditional one. */
function settledTax(s: Start, ordinaryDrawn: number, brokerageDrawn: number) {
  const ss = s.socialSecurity ?? 0;
  const traditional = s.traditional + ordinaryDrawn;
  const gains = brokerageDrawn * (1 - s.basisRatio);
  const taxableSS =
    ss > 0 ? computeTaxableSS(ss, traditional + gains, "MFJ") : 0;
  const slots: DecumulationSlot[] =
    brokerageDrawn > 0
      ? [
          {
            category: "brokerage",
            withdrawal: brokerageDrawn,
            rothWithdrawal: 0,
            traditionalWithdrawal: 0,
            cappedByAccount: false,
            cappedByTaxType: false,
            remainingNeed: 0,
          },
        ]
      : [];
  const { taxCost } = computeTaxFromSlots({
    slots,
    taxableSS,
    balances: { afterTax: 1, afterTaxBasis: s.basisRatio },
    brokerageBasisRatio: s.basisRatio,
    totalTraditionalWithdrawal: traditional,
    totalRothWithdrawal: 0,
    rothTaxableGrowth: 0,
    penaltyCost: 0,
    taxRates: {
      traditionalFallbackRate: 0,
      roth: 0,
      hsa: 0,
      brokerage: 0,
      taxBrackets: MFJ_2026,
      taxMultiplier: s.multiplier,
      ltcgBrackets: LTCG_2026,
      standardDeduction: STD_MFJ_2026,
    },
    filingStatus: "MFJ",
  });
  return taxCost + computeNiit(traditional + taxableSS + gains, gains, "MFJ");
}

const sources = (s: Partial<DrawSources>): DrawSources => ({
  rothBasis: 0,
  rothGrowth: 0,
  rothProRata: 0,
  brokerage: 0,
  hsa: 0,
  ...s,
});

const CASES: [string, Start, DrawSources, number][] = [
  [
    "1.5: across the 0% gains top and the 22% edge",
    { multiplier: 1.5, traditional: 60_000, basisRatio: 0.25 },
    sources({ hsa: 100_000, brokerage: 300_000, rothGrowth: 50_000 }),
    250_000,
  ],
  [
    "2: past the NIIT threshold",
    { multiplier: 2, traditional: 150_000, basisRatio: 0.1 },
    sources({ hsa: 200_000, brokerage: 400_000 }),
    400_000,
  ],
  [
    "3: into the 50% cap on ordinary tax",
    { multiplier: 3, traditional: 300_000, basisRatio: 0 },
    sources({ hsa: 400_000, brokerage: 400_000 }),
    500_000,
  ],
  [
    "0.6: with Social Security made taxable",
    {
      multiplier: 0.6,
      traditional: 40_000,
      socialSecurity: 40_000,
      basisRatio: 0.5,
    },
    sources({ hsa: 60_000, brokerage: 200_000 }),
    150_000,
  ],
];

describe("walkDiscretionaryDraw under the tax multiplier", () => {
  it.each(CASES)(
    "at %s, the walk's predicted tax is settlement's within $1",
    (_label, start, available, need) => {
      const segments = walkDiscretionaryDraw(
        startState(start),
        available,
        need,
      );
      let ordinary = 0;
      let brokerage = 0;
      let predicted = 0;
      for (const segment of segments) {
        predicted += segment.marginalCost * segment.amount;
        if (segment.part === "brokerage") brokerage += segment.amount;
        else ordinary += segment.amount;
      }
      expect(ordinary + brokerage).toBeCloseTo(need, 2);
      const settled =
        settledTax(start, ordinary, brokerage) - settledTax(start, 0, 0);
      expect(Math.abs(predicted - settled)).toBeLessThanOrEqual(1);
    },
  );

  it("at 2, a 22% ordinary dollar (44%) costs more than a 20% gain plus the unscaled 3.8% NIIT (43.8%)", () => {
    // A hand-edited gains table: 0% to 50,000 of taxable income, 20% above.
    // Gross 150,000 is taxable 117,800 (22%); MAGI 400,000 puts every gain
    // dollar past the NIIT threshold. Unscaled, the HSA's 22% beat the
    // brokerage's 23.8%; at 2 the brokerage goes first.
    const segments = walkDiscretionaryDraw(
      {
        ...startState({ multiplier: 2, traditional: 150_000, basisRatio: 0 }),
        magi: 400_000,
        ltcgBrackets: {
          MFJ: [
            { threshold: 50_000, rate: 0 },
            { threshold: null, rate: 0.2 },
          ],
        },
      },
      sources({ hsa: 10_000, brokerage: 10_000 }),
      5_000,
    );
    expect(
      segments.map((s) => [s.part, s.amount, +s.marginalCost.toFixed(9)]),
    ).toEqual([["brokerage", 5_000, 0.438]]);
  });
});
