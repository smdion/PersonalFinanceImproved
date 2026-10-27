/**
 * The household's tax-return filing status (the active Retirement
 * Profile's) drives the household tax and the Roth IRA phase-out — not a
 * W-4, which is a withholding choice. Invented household only.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema-sqlite";
import { createTestCaller, seedJob, seedPerson } from "./setup";
import { loadCapHousehold } from "@/server/helpers/contribution-caps";
import {
  w4FilingStatusOf,
  type SalaryProfileActiveMap,
} from "@/server/helpers/salary";
import {
  buildEnginePayload,
  fetchRetirementData,
} from "@/server/retirement/build-engine-payload";
import { FILING_STATUS_IF_UNKNOWN } from "@/lib/pure/filing-status";
import { recommendationsFromFilingStatus } from "@/lib/pure/recommendations-data";

describe("paycheck: the household's filing status", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  let personId: number;

  beforeAll(async () => {
    ctx = await createTestCaller();
    personId = await seedPerson(ctx.db, "Example Earner", "1985-06-15");
    ctx.db
      .update(schema.people)
      .set({ isPrimaryUser: true })
      .where(eq(schema.people.id, personId))
      .run();
    // Married, but withholding at the Single rate on the W-4.
    seedJob(ctx.db, personId, {
      employerName: "Example Co",
      annualSalary: "150000",
      payPeriod: "biweekly",
      payWeek: "even",
      startDate: "2020-01-01",
      w4FilingStatus: "Single",
    });
  });
  afterAll(() => ctx.cleanup());

  it("with no household setting, the W-4 fills in — for the tax and the IRS limits alike", async () => {
    const s = await ctx.caller.paycheck.computeSummary();
    expect(s.filingStatus).toBe("Single");
    expect(s.filingStatusSource).toBe("w4");
    expect(s.rothIra?.filingStatus).toBe("Single");
    const people = ctx.db.select().from(schema.people).all();
    expect(
      (await loadCapHousehold(ctx.db as never, people, {}, 2026)).filingStatus,
    ).toBe("Single");
  });

  it("the household setting wins over the W-4", async () => {
    await ctx.caller.retirement.retirementSettings.upsert({
      personId,
      retirementAge: 65,
      endAge: 95,
      returnAfterRetirement: "0.06",
      annualInflation: "0.03",
      salaryAnnualIncrease: "0.03",
      filingStatus: "MFJ",
    });
    const s = await ctx.caller.paycheck.computeSummary();
    expect(s.filingStatus).toBe("MFJ");
    expect(s.filingStatusSource).toBe("retirementProfile");
    expect(s.rothIra?.filingStatus).toBe("MFJ");
    expect(s.householdTax).not.toBeNull();
  });

  it("this year's return (the household setting) wins over the Retirement Profile's", async () => {
    await ctx.caller.settings.appSettings.upsert({
      key: "tax_filing_status",
      value: "HOH",
    });
    const s = await ctx.caller.paycheck.computeSummary();
    expect(s.filingStatus).toBe("HOH");
    expect(s.filingStatusSource).toBe("household");
    expect(s.rothIra?.filingStatus).toBe("HOH");
    const people = ctx.db.select().from(schema.people).all();
    expect(
      (await loadCapHousehold(ctx.db as never, people, {}, 2026)).filingStatus,
    ).toBe("HOH");
    // Cleared: back to the profile's.
    await ctx.caller.settings.appSettings.upsert({
      key: "tax_filing_status",
      value: null,
    });
    expect((await ctx.caller.paycheck.computeSummary()).filingStatus).toBe(
      "MFJ",
    );
  });

  it("refuses a status Ledgr doesn't model", async () => {
    await expect(
      ctx.caller.settings.appSettings.upsert({
        key: "tax_filing_status",
        value: "MFS",
      }),
    ).rejects.toThrow(/tax_filing_status/);
  });
});

describe("loadCapHousehold: no setting and no job", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  beforeAll(async () => {
    ctx = await createTestCaller();
    await seedPerson(ctx.db, "No Job Yet", "1990-01-01");
  });
  afterAll(() => ctx.cleanup());

  it("is unknown, never assumed married", async () => {
    const people = ctx.db.select().from(schema.people).all();
    expect(
      (await loadCapHousehold(ctx.db as never, people, {}, 2026)).filingStatus,
    ).toBe("");
  });
});

describe("a Retirement Profile's filing status: Auto, saves, the fallback", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  let personId: number;
  const base = {
    retirementAge: 65,
    endAge: 95,
    returnAfterRetirement: "0.06",
    annualInflation: "0.03",
    salaryAnnualIncrease: "0.03",
  };
  const stored = () =>
    ctx.db
      .select({ f: schema.retirementSettings.filingStatus })
      .from(schema.retirementSettings)
      .where(eq(schema.retirementSettings.personId, personId))
      .get()?.f;
  const engineStatus = async () => {
    const data = await fetchRetirementData(ctx.db as never, {});
    return (await buildEnginePayload(ctx.db as never, data, {}))?.filingStatus;
  };

  beforeAll(async () => {
    ctx = await createTestCaller();
    // Retired: no job, so no W-4 to stand in.
    personId = await seedPerson(ctx.db, "Example Retiree", "1958-03-01");
    ctx.db
      .update(schema.people)
      .set({ isPrimaryUser: true })
      .where(eq(schema.people.id, personId))
      .run();
  });
  afterAll(() => ctx.cleanup());

  it("Auto is stored empty — never defaulted — and nothing known means Single, flagged", async () => {
    await ctx.caller.retirement.retirementSettings.upsert({
      personId,
      ...base,
      filingStatus: null,
    });
    expect(stored()).toBeNull();
    expect(await engineStatus()).toBe(FILING_STATUS_IF_UNKNOWN);
    const s = await ctx.caller.paycheck.computeSummary();
    expect(s.filingStatus).toBeNull();
    expect(recommendationsFromFilingStatus(s.filingStatus)).toHaveLength(1);
  });

  it("Auto follows this year's filing status into the projection", async () => {
    await ctx.caller.settings.appSettings.upsert({
      key: "tax_filing_status",
      value: "HOH",
    });
    expect(await engineStatus()).toBe("HOH");
    expect(
      recommendationsFromFilingStatus(
        (await ctx.caller.paycheck.computeSummary()).filingStatus,
      ),
    ).toEqual([]);
  });

  it("a set profile status wins for retirement years; a save without it keeps it", async () => {
    await ctx.caller.retirement.retirementSettings.upsert({
      personId,
      ...base,
      filingStatus: "Single",
    });
    expect(await engineStatus()).toBe("Single");
    // A save that doesn't send the field (another setting changed).
    await ctx.caller.retirement.retirementSettings.upsert({
      personId,
      ...base,
      retirementAge: 66,
    });
    expect(stored()).toBe("Single");
    await ctx.caller.settings.appSettings.upsert({
      key: "tax_filing_status",
      value: null,
    });
  });
});

describe("w4FilingStatusOf: the request's Salary Profile", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  let personId: number;
  let jobId: number;
  beforeAll(async () => {
    ctx = await createTestCaller();
    personId = await seedPerson(ctx.db, "Example Earner", "1985-06-15");
    jobId = seedJob(ctx.db, personId, {
      employerName: "Example Co",
      annualSalary: "90000",
      payPeriod: "biweekly",
      payWeek: "even",
      startDate: "2020-01-01",
      w4FilingStatus: "Single",
    });
  });
  afterAll(() => ctx.cleanup());

  it("reads a What-If's W-4 when given its map, else the active profile's", async () => {
    expect(await w4FilingStatusOf(ctx.db as never, [personId])).toBe("Single");
    const whatIf = new Map([
      [jobId, { w4FilingStatus: "HOH" } as never],
    ]) as SalaryProfileActiveMap;
    expect(await w4FilingStatusOf(ctx.db as never, [personId], whatIf)).toBe(
      "HOH",
    );
  });
});
