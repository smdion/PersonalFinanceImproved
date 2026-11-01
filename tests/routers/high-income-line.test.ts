/**
 * The default high-income line follows this year's filing status — the
 * same resolver as the paycheck: a W-4 when nothing else is set, the
 * household setting over it. Invented household only.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCaller, seedJob, seedPerson } from "./setup";

describe("contribution.highIncomeLine", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;

  beforeAll(async () => {
    ctx = await createTestCaller();
  });
  afterAll(() => ctx.cleanup());

  it("with nobody set up, the single line by household size", async () => {
    expect(await ctx.caller.contribution.highIncomeLine()).toEqual({
      threshold: 100_000,
      basis: "people",
    });
  });

  it("a Single W-4 gives the single line; the household setting moves it", async () => {
    const personId = await seedPerson(ctx.db, "Example Earner", "1985-06-15");
    seedJob(ctx.db, personId, {
      employerName: "Example Co",
      annualSalary: "150000",
      payPeriod: "biweekly",
      payWeek: "even",
      startDate: "2020-01-01",
      w4FilingStatus: "Single",
    });
    expect(await ctx.caller.contribution.highIncomeLine()).toEqual({
      threshold: 100_000,
      basis: "Single",
    });
    await ctx.caller.settings.appSettings.upsert({
      key: "tax_filing_status",
      value: "MFJ",
    });
    expect(await ctx.caller.contribution.highIncomeLine()).toEqual({
      threshold: 200_000,
      basis: "MFJ",
    });
  });
});
