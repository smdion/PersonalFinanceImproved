/**
 * Tax Optimization surface — `projection.projectTaxYears` /
 * `compareWithdrawalStrategies` / `rothConversionWhatIf`.
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
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
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

  // seedStandardDataset uses a Jan-1 DOB. `new Date("1990-01-01")` is UTC
  // midnight, which reads back as the PRIOR YEAR in any timezone behind UTC
  // — so the engine's birth-year-derived retirement schedule, and this
  // file's golden snapshot, shifted by a full year between a local run and
  // CI (UTC). Pin a mid-year DOB: still 1990 in every timezone.
  db.update(schema.people)
    .set({ dateOfBirth: "1990-07-01" })
    .where(eq(schema.people.id, personId))
    .run();

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
      contributionMethod: "percent_of_salary",
      contributionValue: "0.10",
      taxTreatment: "pre_tax",
      employerMatchType: "none",
      isActive: true,
      personId,
      performanceAccountId: perfAcctId,
      parentCategory: "Retirement",
    })
    .run();
}

describe("projection router — projectTaxYears", () => {
  it("returns an empty result when no retirement data is seeded", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const res = await caller.projection.projectTaxYears({});
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
      await expect(caller.projection.projectTaxYears({})).rejects.toThrow();
    } finally {
      cleanup();
    }
  });

  it("returns one row per decumulation year with a monotonic cumulative tax", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedTaxOptHousehold(db);

      const res = await caller.projection.projectTaxYears({});
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

  it("derived TaxYearRow[] shape is stable (golden file)", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedTaxOptHousehold(db);
      const res = await caller.projection.projectTaxYears({});
      expect(res.rows).toMatchSnapshot();
    } finally {
      cleanup();
    }
  });
});

describe("projection router — withdrawal routing DB fallback", () => {
  it("'Your current plan' resolves the household's persisted withdrawal_routing_mode, not a hardcoded default", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedTaxOptHousehold(db);
      // No client override is ever sent here (compareWithdrawalStrategies's
      // input carries no decumulationDefaults) — this only proves the DB
      // value if the household's own persisted setting differs from
      // "bracket_filling" and the resolved mode reflects THAT, not the
      // schema's request-level fallback.
      db.update(schema.retirementSettings)
        .set({ withdrawalRoutingMode: "waterfall" })
        .run();

      const res = await caller.projection.compareWithdrawalStrategies({
        strategies: [
          { label: "A", mode: "waterfall" },
          { label: "B", mode: "bracket_filling" },
        ],
      });
      const currentPlan = res.strategies.find(
        (s) => s.label === "Your current plan",
      );
      expect(currentPlan?.mode).toBe("waterfall");
      // The resolved order, not just the mode — the client needs this to
      // tell whether a waterfall household matches one of the named
      // presets (withdrawal-comparison.tsx's "same as your current plan"
      // annotation) rather than just sharing a routing mode.
      expect(Array.isArray(currentPlan?.withdrawalOrder)).toBe(true);
      expect(currentPlan?.withdrawalOrder.length).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });
});

describe("projection router — compareWithdrawalStrategies", () => {
  it("scores each strategy and names the cheapest as baselineLabel", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedTaxOptHousehold(db);
      const res = await caller.projection.compareWithdrawalStrategies({
        strategies: [
          {
            label: "Traditional first",
            mode: "waterfall",
            order: ["401k", "403b", "ira", "brokerage", "hsa"],
          },
          { label: "Tax-optimized", mode: "bracket_filling" },
        ],
      });
      // 2 named strategies + the server's own "Your current plan" baseline
      // row (the household's real resolved defaults, scored the same way —
      // see compareWithdrawalStrategies's docblock).
      expect(res.strategies).toHaveLength(3);
      expect(res.strategies.some((s) => s.label === "Your current plan")).toBe(
        true,
      );
      for (const s of res.strategies) {
        expect(s.lifetimeTax).toBeGreaterThanOrEqual(0);
        expect(s).toHaveProperty("terminalByTaxType");
        expect(s).toHaveProperty("depletedYear");
      }
      const cheapest = res.strategies
        .slice()
        .sort((a, b) => a.lifetimeTax - b.lifetimeTax)[0];
      // baselineLabel is only forced to the overall-cheapest when at least
      // one strategy doesn't deplete; this fixture doesn't deplete.
      expect(res.baselineLabel).toBe(cheapest.label);
    } finally {
      cleanup();
    }
  });

  it("bracket_filling never costs more lifetime tax than naive traditional-first", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedTaxOptHousehold(db);
      const res = await caller.projection.compareWithdrawalStrategies({
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

describe("projection router — rothConversionWhatIf", () => {
  it("optimize mode delegates to optimizeRothBracketTarget (candidates sorted by netCost)", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedTaxOptHousehold(db);
      const res = await caller.projection.rothConversionWhatIf({
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
        expect(r.candidates[i].netCost).toBeGreaterThanOrEqual(
          r.candidates[i - 1].netCost,
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
      const base = await caller.projection.projectTaxYears({});
      const firstYear = base.rows[0].year;
      const lastYear = base.rows[base.rows.length - 1].year;
      const startingTraditional = base.rows[0].balanceByTaxType.preTax;

      const res = await caller.projection.rothConversionWhatIf({
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
