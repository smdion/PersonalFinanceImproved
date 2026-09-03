/**
 * Tax Planning surface — `projection.projectTaxYears` /
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
function seedTaxPlanningHousehold(
  db: BetterSQLite3Database<typeof sqliteSchema>,
) {
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
      seedTaxPlanningHousehold(db);

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
      seedTaxPlanningHousehold(db);
      const res = await caller.projection.projectTaxYears({});
      expect(res.rows).toMatchSnapshot();
    } finally {
      cleanup();
    }
  });
});
