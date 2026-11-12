/**
 * Tax Optimization surface — `projection.computeTaxProjection` /
 * `computeWithdrawalStrategyComparison` / `computeRothConversionWhatIf`.
 *
 * Mirrors `withdrawal-bracket-optimizer.test.ts`: null/empty result when
 * unseeded, a real shape with a fixed seeded household, auth gating, and
 * a golden-file snapshot of the derived `TaxYearRow[]` (NOT raw engine
 * output — the snapshot is over the router's own contract so an unrelated
 * engine tweak that leaves the contract intact doesn't churn it). The
 * targeted assertions alongside it (row count, monotonic cumulative tax,
 * non-negative federal tax) are what actually guard behaviour; the
 * snapshot just catches an unintended shape change.
 *
 * The engine call here is the DETERMINISTIC projection (no RNG), so the
 * snapshot is stable run-to-run.
 */
import "./setup-mocks";
import { describe, it, expect, assert } from "vitest";
import { createTestCaller, adminSession, seedStandardDataset } from "./setup";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "@/lib/db/schema-sqlite";
import * as schema from "@/lib/db/schema-sqlite";

const RETIREMENT_AGE = 65;
const END_AGE = 90;

/** Same fixture shape as withdrawal-bracket-optimizer.test.ts —
 *  duplicated locally (the helper there isn't exported) to keep this file
 *  self-contained, per the convention of the single-endpoint router test
 *  files in this directory. Roth conversions ON so the Roth-related
 *  columns and the what-if procedure have something to chew on. */
function seedTaxOptHousehold(db: BetterSQLite3Database<typeof sqliteSchema>) {
  const { personId, perfAcctId } = seedStandardDataset(db);

  db.insert(schema.retirementSettings)
    .values({
      personId,
      retirementAge: RETIREMENT_AGE,
      endAge: END_AGE,
      returnAfterRetirement: "0.05",
      annualInflation: "0.03",
      postRetirementInflation: "0.025",
      salaryAnnualIncrease: "0.02",
      withdrawalRate: "0.04",
      taxMultiplier: "1.0",
      grossUpForTaxes: true,
      withdrawalStrategy: "fixed",
      gkSkipInflationAfterLoss: true,
      socialSecurityMonthly: "2500",
      ssStartAge: 67,
      enableRothConversions: true,
      enableIrmaaAwareness: true,
      enableAcaAwareness: false,
      householdSize: 2,
      filingStatus: "MFJ",
    })
    .run();

  db.insert(schema.returnRateTable)
    .values({ age: 35, rateOfReturn: "0.07" })
    .run();
  db.insert(schema.returnRateTable)
    .values({ age: 65, rateOfReturn: "0.05" })
    .run();

  db.insert(schema.contributionAccounts)
    .values({
      accountType: "401k",
      taxTreatment: "pre_tax",
      employerMatchType: "none",
      isActive: true,
      personId,
      performanceAccountId: perfAcctId,
      parentCategory: "Retirement",
    })
    .run();
}

describe("projection router — computeTaxProjection", () => {
  it("no return rate: each tool says to set one, instead of the engine throwing", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedTaxOptHousehold(db);
      db.delete(schema.returnRateTable).run();
      expect(await caller.projection.computeTaxProjection({})).toMatchObject({
        rows: [],
        notConfigured: "no_return_rate",
      });
      expect(
        await caller.projection.computeWithdrawalStrategyComparison({
          strategies: [
            { label: "A", mode: "waterfall" },
            { label: "B", mode: "bracket_filling" },
          ],
        }),
      ).toMatchObject({ strategies: [], notConfigured: "no_return_rate" });
      expect(
        await caller.projection.computeRothConversionWhatIf({
          mode: "optimize",
        }),
      ).toMatchObject({ result: null, notConfigured: "no_return_rate" });
    } finally {
      cleanup();
    }
  });

  it("returns an empty result when no retirement data is seeded", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const res = await caller.projection.computeTaxProjection({});
      expect(res).toEqual({ rows: [], meta: null });
    } finally {
      cleanup();
    }
  });

  it("rejects unauthenticated access", async () => {
    const { caller, cleanup } = await createTestCaller({
      user: null as never,
      expires: "",
    } as never);
    try {
      await expect(
        caller.projection.computeTaxProjection({}),
      ).rejects.toThrow();
    } finally {
      cleanup();
    }
  });

  it("returns one row per decumulation year with a monotonic cumulative tax", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedTaxOptHousehold(db);

      const res = await caller.projection.computeTaxProjection({});
      // The engine's decumulation phase spans retirementAge..endAge
      // exclusive of the final age — 25 years for 65->90.
      expect(res.rows.length).toBe(END_AGE - RETIREMENT_AGE);
      expect(res.meta?.bracketsThroughYear).toBeGreaterThan(2020);

      let prevCumulative = -1;
      let prevYear = 0;
      for (const row of res.rows) {
        expect(row.federalTax).toBeGreaterThanOrEqual(0);
        expect(row.cumulativeTax).toBeGreaterThanOrEqual(prevCumulative);
        expect(row.year).toBeGreaterThan(prevYear);
        prevCumulative = row.cumulativeTax;
        prevYear = row.year;
      }
    } finally {
      cleanup();
    }
  });

  // The figures the old 22 KB golden file held that move, by name, and
  // the ones that don't, once. Bug pin (verdict N8): `acaSubsidyPreserved:
  // false` and the "ACA lost" flag on every row, though this household has
  // ACA awareness off and nothing was checked. Changes on purpose with the
  // v0.11 Retirement rules item: ACA reported "lost" when never checked
  // (answer-key ret/A31, `tests/pure/advice/report/aca-irmaa-narrative.test.ts`).
  it("every TaxYearRow's figures, by name", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedTaxOptHousehold(db);
      const res = await caller.projection.computeTaxProjection({});
      // Headline figures first.
      expect(res.rows).toHaveLength(25);
      expect(res.rows[0]!.federalTax).toBe(198.47);
      expect(res.rows[0]!.income.rothConversion).toBe(235557.06);
      expect(res.rows.at(-1)!.cumulativeTax).toBe(62678.119999999995);
      expect(res.rows.at(-1)!.retirementBalance).toBe(13413751.48);
      // What holds on every row.
      for (const r of res.rows) {
        expect(r).toMatchObject({
          acaMagiHeadroom: 0,
          acaSubsidyPreserved: false,
          irmaaSurcharge: 0,
          niit: 0,
          qcdAmount: 0,
          rmdExcess: 0,
          rmdShortfall: 0,
          unmetNeed: 0,
          income: { requiredMinimumDistribution: 0, rothWithdrawal: 0 },
          balanceByTaxType: { hsa: 0 },
        });
        expect(r.flags).toContain("ACA lost");
      }
      // Each year: year, age, federal tax, cumulative tax, Traditional
      // withdrawal, Roth conversion and its tax, other withdrawal, Social
      // Security and its taxable part, LTCG rate, Roth balance, retirement
      // balance, flags.
      expect(
        res.rows.map((r) => [
          r.year,
          r.age,
          r.federalTax,
          r.cumulativeTax,
          r.income.traditionalWithdrawal,
          r.income.rothConversion,
          r.rothConversionTax,
          r.income.otherWithdrawal,
          r.income.socialSecurity,
          r.taxableSocialSecurity,
          r.ltcgRate,
          r.balanceByTaxType.taxFree,
          r.retirementBalance,
          r.flags,
        ]),
      ).toEqual(
        // prettier-ignore
        [
        [2055, 65, 198.47, 27336.16, 81754.49, 235557.06, 27137.69, 0, 0, 0, 0.15, 247334.91, 4355546.05, ["ACA lost", "Roth conversion"]],
        [2056, 66, 159.12, 55492.399999999994, 83754.04, 243076.85, 27997.12, 0, 0, 0, 0.15, 514932.35, 4455984.63, ["ACA lost", "Roth conversion"]],
        [2057, 67, 0, 62678.119999999995, 8432.31, 137810.28, 7185.72, 0, 77252.48, 8599.77, 0, 685379.76, 4662384.93, ["ACA lost", "Roth conversion"]],
        [2058, 68, 0, 62678.119999999995, 0, 0, 0, 8256.85, 79570.06, 7376.94, 0, 719648.75, 4886834.49, ["ACA lost"]],
        [2059, 69, 0, 62678.119999999995, 0, 0, 0, 8065.43, 81957.16, 8372.23, 0, 755631.19, 5122707.52, ["ACA lost"]],
        [2060, 70, 0, 62678.119999999995, 0, 0, 0, 7857.28, 84415.87, 9378.53, 0, 793412.75, 5370592.75, ["ACA lost"]],
        [2061, 71, 0, 62678.119999999995, 0, 0, 0, 7631.63, 86948.35, 10396.25, 0, 833083.39, 5631109.18, ["ACA lost"]],
        [2062, 72, 0, 62678.119999999995, 0, 0, 0, 7387.68, 89556.8, 11425.79, 0, 874737.56, 5904907.58, ["ACA lost"]],
        [2063, 73, 0, 62678.119999999995, 0, 0, 0, 7124.59, 92243.5, 12467.57, 0, 918474.44, 6192672.14, ["ACA lost"]],
        [2064, 74, 0, 62678.119999999995, 0, 0, 0, 6841.48, 95010.81, 13521.99, 0, 964398.16, 6495122.19, ["ACA lost"]],
        [2065, 75, 0, 62678.119999999995, 0, 0, 0, 6537.47, 97861.13, 14589.44, 0, 1012618.07, 6813013.96, ["ACA lost"]],
        [2066, 76, 0, 62678.119999999995, 0, 0, 0, 6211.59, 100796.97, 15670.33, 0, 1063248.97, 7147142.49, ["ACA lost"]],
        [2067, 77, 0, 62678.119999999995, 0, 0, 0, 5862.9, 103820.88, 16765.06, 0, 1116411.42, 7498343.57, ["ACA lost"]],
        [2068, 78, 0, 62678.119999999995, 0, 0, 0, 5490.37, 106935.5, 17874.02, 0, 1172231.99, 7867495.86, ["ACA lost"]],
        [2069, 79, 0, 62678.119999999995, 0, 0, 0, 5092.95, 110143.57, 18997.59, 0, 1230843.59, 8255523.06, ["ACA lost"]],
        [2070, 80, 0, 62678.119999999995, 0, 0, 0, 4669.55, 113447.88, 20136.17, 0, 1292385.77, 8663396.19, ["ACA lost"]],
        [2071, 81, 0, 62678.119999999995, 0, 0, 0, 4219.06, 116851.31, 21290.14, 0, 1357005.06, 9092135.99, ["ACA lost"]],
        [2072, 82, 0, 62678.119999999995, 0, 0, 0, 3740.28, 120356.85, 22459.9, 0, 1424855.31, 9542815.49, ["ACA lost"]],
        [2073, 83, 0, 62678.119999999995, 0, 0, 0, 3232, 123967.56, 23645.8, 0, 1496098.08, 10016562.67, ["ACA lost"]],
        [2074, 84, 0, 62678.119999999995, 0, 0, 0, 2692.96, 127686.58, 24848.22, 0, 1570902.98, 10514563.19, ["ACA lost"]],
        [2075, 85, 0, 62678.119999999995, 0, 0, 0, 2121.85, 131517.18, 26067.56, 0, 1649448.13, 11038063.41, ["ACA lost"]],
        [2076, 86, 0, 62678.119999999995, 0, 0, 0, 1517.31, 135462.7, 27304.17, 0, 1731920.54, 11588373.41, ["ACA lost"]],
        [2077, 87, 0, 62678.119999999995, 0, 0, 0, 877.93, 139526.58, 28558.41, 0, 1818516.57, 12166870.26, ["ACA lost"]],
        [2078, 88, 0, 62678.119999999995, 0, 0, 0, 202.25, 143712.37, 29830.66, 0, 1909442.4, 12775001.41, ["ACA lost"]],
        [2079, 89, 0, 62678.119999999995, 0, 0, 0, 0, 148023.75, 31510.09, 0, 2004914.52, 13413751.48, ["ACA lost"]],
        ],
      );
    } finally {
      cleanup();
    }
  });
});

describe("projection router — withdrawal routing DB fallback", () => {
  it("'Your current settings' resolves the household's persisted withdrawal_routing_mode, not a hardcoded default", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedTaxOptHousehold(db);
      // No client override is ever sent here (computeWithdrawalStrategyComparison's
      // input carries no decumulationDefaults) — this only proves the DB
      // value if the household's own persisted setting differs from
      // "bracket_filling" and the resolved mode reflects THAT, not the
      // schema's request-level fallback.
      db.update(schema.retirementSettings)
        .set({ withdrawalRoutingMode: "waterfall" })
        .run();

      const res = await caller.projection.computeWithdrawalStrategyComparison({
        strategies: [
          { label: "A", mode: "waterfall" },
          { label: "B", mode: "bracket_filling" },
        ],
      });
      assert(!("notConfigured" in res));
      const currentPlan = res.strategies.find(
        (s) => s.label === "Your current settings",
      );
      expect(currentPlan?.mode).toBe("waterfall");
      // The resolved order, not just the mode — the client needs this to
      // tell whether a waterfall household matches one of the named
      // presets (withdrawal-comparison.tsx's "same as your current settings"
      // annotation) rather than just sharing a routing mode.
      assert(currentPlan && "withdrawalOrder" in currentPlan);
      expect(Array.isArray(currentPlan.withdrawalOrder)).toBe(true);
      expect(currentPlan.withdrawalOrder.length).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });
});

describe("projection router — computeWithdrawalStrategyComparison", () => {
  it("scores each strategy and names the cheapest as baselineLabel", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedTaxOptHousehold(db);
      const res = await caller.projection.computeWithdrawalStrategyComparison({
        strategies: [
          {
            label: "Traditional first",
            mode: "waterfall",
            order: ["401k", "403b", "ira", "brokerage", "hsa"],
          },
          { label: "Tax-optimized", mode: "bracket_filling" },
        ],
      });
      // 2 named strategies + the server's own "Your current settings" baseline
      // row (the household's real resolved defaults, scored the same way —
      // see computeWithdrawalStrategyComparison's docblock).
      expect(res.strategies).toHaveLength(3);
      expect(
        res.strategies.some((s) => s.label === "Your current settings"),
      ).toBe(true);
      for (const s of res.strategies) {
        expect(s.lifetimeTax).toBeGreaterThanOrEqual(0);
        expect(s).toHaveProperty("terminalByTaxType");
        expect(s).toHaveProperty("failureYear");
      }
      const cheapest = res.strategies
        .slice()
        .sort((a, b) => a.lifetimeTax - b.lifetimeTax)[0];
      // baselineLabel is only forced to the overall-cheapest when at least
      // one strategy doesn't deplete; this fixture doesn't deplete.
      expect(res.baselineLabel).toBe(cheapest!.label);
    } finally {
      cleanup();
    }
  });

  it("bracket_filling never costs more lifetime tax than naive traditional-first", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedTaxOptHousehold(db);
      const res = await caller.projection.computeWithdrawalStrategyComparison({
        strategies: [
          {
            label: "trad-first",
            mode: "waterfall",
            order: ["401k", "403b", "ira", "brokerage", "hsa"],
          },
          { label: "optimized", mode: "bracket_filling" },
        ],
      });
      const tradFirst = res.strategies.find((s) => s.label === "trad-first")!;
      const optimized = res.strategies.find((s) => s.label === "optimized")!;
      // Tax-optimized routing never loses to naive on LIFETIME tax.
      // `<=` with tolerance, not `<` — some balance mixes legitimately tie.
      expect(optimized.lifetimeTax).toBeLessThanOrEqual(
        tradFirst.lifetimeTax + 1e-6,
      );
    } finally {
      cleanup();
    }
  });
});

describe("projection router — computeRothConversionWhatIf", () => {
  it("optimize mode delegates to optimizeRothBracketTarget (candidates sorted by netCost)", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedTaxOptHousehold(db);
      const res = await caller.projection.computeRothConversionWhatIf({
        mode: "optimize",
      });
      expect(res.mode).toBe("optimize");
      expect(res.result).not.toBeNull();
      const r = res.result as {
        recommendedTarget: number | null;
        currentTarget: number | null;
        candidates: { target: number; netCost: number }[];
      };
      expect(r.candidates.length).toBeGreaterThan(0);
      for (let i = 1; i < r.candidates.length; i++) {
        expect(r.candidates[i]!.netCost).toBeGreaterThanOrEqual(
          r.candidates[i - 1]!.netCost,
        );
      }
    } finally {
      cleanup();
    }
  });

  it("explicit mode returns a before/after with a sane break-even and bounded conversions", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedTaxOptHousehold(db);

      // Baseline projection to learn the horizon + starting Traditional balance.
      const base = await caller.projection.computeTaxProjection({});
      const firstYear = base.rows[0]!.year;
      const lastYear = base.rows[base.rows.length - 1]!.year;
      const startingTraditional = base.rows[0]!.balanceByTaxType.preTax;

      const res = await caller.projection.computeRothConversionWhatIf({
        mode: "explicit",
        conversionTargets: [{ year: firstYear, targetRate: 0.24 }],
      });
      expect(res.mode).toBe("explicit");
      const r = res.result as {
        perYear: { year: number; conversionAmount: number }[];
        breakEvenYear: number | null;
        lifetimeTaxWith: number;
        lifetimeTaxWithout: number;
      };
      expect(r.perYear.length).toBeGreaterThan(0);

      if (r.breakEvenYear !== null) {
        expect(r.breakEvenYear).toBeGreaterThanOrEqual(firstYear);
        expect(r.breakEvenYear).toBeLessThanOrEqual(lastYear);
      }

      const totalConverted = r.perYear.reduce(
        (s, y) => s + y.conversionAmount,
        0,
      );
      // Can't convert more Traditional than existed at the start (+ growth
      // that lands in Traditional along the way — generous 3x headroom).
      expect(totalConverted).toBeLessThanOrEqual(startingTraditional * 3);
      expect(r.lifetimeTaxWith).toBeGreaterThanOrEqual(0);
      expect(r.lifetimeTaxWithout).toBeGreaterThanOrEqual(0);
    } finally {
      cleanup();
    }
  });
});
