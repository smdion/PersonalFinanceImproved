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
