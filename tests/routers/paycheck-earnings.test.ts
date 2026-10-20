/**
 * Other pay & taxable benefits: structural rows (settings.earnings) with
 * their per-check amounts in the Salary Profile entry (otherEarnings), and
 * the paycheck/tax reading them. Invented household only.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import { createTestCaller, seedJob, seedPerson } from "./setup";

describe("paycheck earnings", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  let jobId: number;

  const setAmount = (earningId: number, amount: number) => {
    const [profile] = ctx.db.select().from(sqliteSchema.salaryProfiles).all();
    const salaries = { ...profile!.salaries };
    salaries[String(jobId)] = {
      ...salaries[String(jobId)]!,
      otherEarnings: { [String(earningId)]: amount },
    };
    ctx.db.update(sqliteSchema.salaryProfiles).set({ salaries }).run();
  };

  beforeAll(async () => {
    ctx = await createTestCaller();
    const personId = await seedPerson(ctx.db, "Example Earner", "1985-06-15");
    jobId = seedJob(ctx.db, personId, {
      employerName: "Example Co",
      annualSalary: "104000",
      payPeriod: "biweekly",
      payWeek: "even",
      startDate: "2020-01-01",
      w4FilingStatus: "MFJ",
    });
  });
  afterAll(() => ctx.cleanup());

  it("a taxable benefit that isn't paid raises taxes, not take-home", async () => {
    const before = (await ctx.caller.paycheck.computeSummary()).people[0]!
      .paycheck!;
    const row = await ctx.caller.settings.earnings.create({
      jobId,
      earningName: "Group life over $50k",
      isCash: false,
      federalTaxable: true,
      ficaTaxable: true,
    });
    setAmount(row!.id, 10);
    const s = await ctx.caller.paycheck.computeSummary();
    const after = s.people[0]!.paycheck!;
    expect(after.gross).toBe(before.gross);
    expect(after.federalTaxableGross).toBeCloseTo(
      before.federalTaxableGross + 10,
      2,
    );
    expect(after.ficaWages).toBeCloseTo(before.ficaWages + 10, 2);
    expect(after.netPay).toBeLessThan(before.netPay);
    // It's in federal wages (AGI) for the year, not in cash pay.
    expect(s.people[0]!.earnings!.imputedIncome).toBe(260);
    expect(s.householdIncome!.gross).toBe(104000);
    expect(s.householdTax!.wageAgi).toBeCloseTo(
      s.people[0]!.earnings!.federalWages,
      2,
    );
  });

  it("refuses a benefit that's neither paid nor taxed", async () => {
    await expect(
      ctx.caller.settings.earnings.create({
        jobId,
        earningName: "Nothing",
        isCash: false,
        federalTaxable: false,
        ficaTaxable: false,
      }),
    ).rejects.toThrow(/must be taxed/);
  });

  it("deleting a line also drops its amount from every Salary Profile", async () => {
    const [row] = await ctx.caller.settings.earnings.list();
    await ctx.caller.settings.earnings.delete({ id: row!.id });
    const [profile] = ctx.db.select().from(sqliteSchema.salaryProfiles).all();
    expect(profile!.salaries[String(jobId)]!.otherEarnings).toEqual({});
    expect(await ctx.caller.settings.earnings.list()).toEqual([]);
  });
});
