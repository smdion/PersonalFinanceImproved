/**
 * A stored withholding table with a negative rate (a hand edit, or a newer
 * Ledgr's table) reads as 0% in the paycheck and in job net pay, the same
 * reader the projection uses (resolveTaxYear), never a negative tax. The
 * paycheck page names it; the stored rows are kept as they are. Invented
 * household only.
 */
import "./setup-mocks";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

import { eq } from "drizzle-orm";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import { adminSession, createTestCaller, seedJob, seedPerson } from "./setup";
import { computeJobNetPayPerCheck } from "@/server/services/paycheck/job-net-pay";

const AS_OF = new Date("2026-03-07T12:00:00");

/** The paycheck summary and job net pay with every standard table's second
 *  bracket rate stored as `rate`, and that bracket's stored rates after. */
async function withSecondRate(rate: number) {
  const ctx = await createTestCaller(adminSession);
  try {
    const personId = await seedPerson(ctx.db, "Rate Reader", "1985-06-15");
    const jobId = seedJob(ctx.db, personId, {
      annualSalary: "150000",
      payPeriod: "biweekly",
      w4FilingStatus: "Single",
    });
    const rows = ctx.db.select().from(sqliteSchema.taxBrackets).all();
    for (const row of rows.filter((r) => !r.w4Checkbox))
      ctx.db
        .update(sqliteSchema.taxBrackets)
        .set({
          brackets: row.brackets.map((b, i) => (i === 1 ? { ...b, rate } : b)),
        })
        .where(eq(sqliteSchema.taxBrackets.id, row.id))
        .run();
    const summary = await ctx.caller.paycheck.computeSummary();
    const netPay = await computeJobNetPayPerCheck(ctx.rawDb, jobId, AS_OF);
    const storedRates = ctx.db
      .select()
      .from(sqliteSchema.taxBrackets)
      .all()
      .filter((r) => !r.w4Checkbox)
      .map((r) => r.brackets[1]!.rate);
    return { summary, netPay, storedRates };
  } finally {
    ctx.cleanup();
  }
}

describe("a negative stored withholding rate", () => {
  it("reads as 0% in the paycheck and job net pay, named on the page, kept stored", async () => {
    const zero = await withSecondRate(0);
    const negative = await withSecondRate(-0.1);

    const { unknownTypeNotes: notes, ...figures } = negative.summary;
    const { unknownTypeNotes: zeroNotes, ...zeroFigures } = zero.summary;
    expect(figures).toEqual(zeroFigures);
    expect(zeroNotes).toEqual([]);
    // Only the table the paycheck reads is named, not every table of the year.
    expect(notes).toEqual([
      "The Single withholding table (Tax Brackets) has a negative rate, read as 0%. Fix it in Settings → Reference Data.",
    ]);

    expect(negative.netPay.netPayPerCheck).toBe(zero.netPay.netPayPerCheck);
    // job net pay has no page to name it on; its stored-figure gate
    // (unknownTypeNotes) stays for unknown account types only.
    expect(negative.netPay.unknownTypeNotes).toEqual([]);

    expect(negative.storedRates.every((r) => r === -0.1)).toBe(true);
  });
});
