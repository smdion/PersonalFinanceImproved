/**
 * Answer key, tax (the Taxes page): this year's household federal tax as
 * `paycheck.computeSummary` gives it (`householdTax`, from
 * `calculateHouseholdTax` in `src/lib/pure/tax/tax.ts`; there's no tax
 * router). Figures worked by hand from the published rules; source of the
 * cases: the November review's tax verdicts (`rebuild/annual-tax-verdicts.md`
 * § 1 and "Cases ready to become answer-key tests"), as collected in the
 * draft answer key (`.scratch/docs/drafts/answer-key.md` § Tax, R-S67 and
 * R-MFJ68). Invented households on the seeded test database, 2026 tables,
 * the clock held in 2026.
 *
 * The page takes the basic standard deduction, the 65+ add-on (IRC 63(f);
 * i1040 p.35 chart) and the senior deduction (IRC 151(d)(5)(C); Schedule
 * 1-A Part V) for each person on the return 65+ at year end. 2026
 * figures (Rev. Proc. 2025-32 § 4.01, § 4.14): basic 16,100 Single, 32,200 MFJ; add-on 2,050 unmarried, 1,650
 * married; senior 6,000 a qualified person, reduced 6% of MAGI over 75,000
 * (150,000 joint), not indexed (spec SD-1, SR-2, SR-6, SR-7, SR-10).
 */
import "./setup-mocks";
import { afterAll, beforeAll, describe, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema-sqlite";
import { createTestCaller, seedJob, seedPerson } from "./setup";
import { cents } from "../fixtures/answer-key";

const NOW = new Date("2026-08-14T12:00:00");

type Caller = Awaited<ReturnType<typeof createTestCaller>>;

/** A household of `people`, the first with a job paying `wages` (no
 *  payroll deductions, so wage AGI = wages), filing `status`. */
function household(
  status: "Single" | "MFJ",
  people: { name: string; born: string }[],
  wages: number,
) {
  let ctx: Caller;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    ctx = await createTestCaller();
    const ids: number[] = [];
    for (const p of people) ids.push(await seedPerson(ctx.db, p.name, p.born));
    ctx.db
      .update(schema.people)
      .set({ isPrimaryUser: true })
      .where(eq(schema.people.id, ids[0]!))
      .run();
    seedJob(ctx.db, ids[0]!, {
      employerName: "Example Co",
      annualSalary: String(wages),
      payPeriod: "biweekly",
      payWeek: "even",
      startDate: "2020-01-01",
      w4FilingStatus: status,
    });
    // This year's return, not a W-4 standing in for it.
    await ctx.caller.settings.appSettings.upsert({
      key: "tax_filing_status",
      value: status,
    });
  });
  afterAll(() => {
    ctx.cleanup();
    vi.useRealTimers();
  });
  return async () => {
    const s = await ctx.caller.paycheck.computeSummary({
      taxYearOverride: 2026,
    });
    if (!s.householdTax) throw new Error("no household tax");
    return {
      taxableIncome: s.householdTax.taxableIncome,
      federalTax: s.householdTax.federalTax,
    };
  };
}

describe("answer key: the Taxes page counts age", () => {
  describe("tax/R-S67 [TAX-01]", () => {
    // 2026 Single, born 1959-06-15: 67 by year end (before 1962-01-02,
    // spec SD-2). Wages 60,000 = AGI = MAGI. Deductions: basic 16,100 +
    // add-on 2,050 = 18,150 (line 12e) + senior 6,000 (MAGI under
    // 75,000, no reduction; line 13b) = 24,150. TI = 60,000 − 24,150 =
    // 35,850. Tax (RP25 Table 3): 10% × 12,400 = 1,240 + 12% × (35,850 −
    // 12,400 = 23,450) = 2,814 → 4,054.00.
    const run = household(
      "Single",
      [{ name: "Example Retiree", born: "1959-06-15" }],
      60_000,
    );
    it("tax/R-S67 [TAX-01] Single 67 on 60,000: tax 4,054", async () => {
      cents(await run(), { taxableIncome: 35_850, federalTax: 4_054 });
    });
  });

  describe("tax/R-MFJ68 [TAX-01]", () => {
    // 2026 MFJ, born 1958-03-10 (68) and 1959-09-20 (67): both 65+. One
    // job, wages 100,000 = AGI = MAGI. Deductions: 32,200 + 2 × 1,650 =
    // 35,500 (line 12e) + senior 2 × 6,000 = 12,000 (MAGI under 150,000;
    // Schedule 1-A lines 36a, 36b) = 47,500. TI = 100,000 − 47,500 =
    // 52,500. Tax (RP25 Table 1): 10% × 24,800 = 2,480 + 12% × 27,700 =
    // 3,324 → 5,804.00.
    const run = household(
      "MFJ",
      [
        { name: "Example Earner", born: "1958-03-10" },
        { name: "Example Spouse", born: "1959-09-20" },
      ],
      100_000,
    );
    it("tax/R-MFJ68 [TAX-01] MFJ both 65+ on 100,000: tax 5,804", async () => {
      cents(await run(), { taxableIncome: 52_500, federalTax: 5_804 });
    });
  });
});
