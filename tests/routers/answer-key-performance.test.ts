/**
 * Answer key, household: Performance edits, cascades, the ESPP transfer and
 * finalizing a year, through the real routers on the test SQLite database
 * (`.scratch/docs/drafts/answer-key.md` § Household math; the household
 * verdicts' § "Cases with no callable function, run through the real
 * routers", whose probe `.scratch/docs/drafts/answer-key-inputs/household/
 * cascade.test.ts` this file is lifted from; worked cases in `reviews/
 * 2026-11-01/specs/household-math.md` §§ 3, 4, 6). Ids are the spec's own,
 * prefixed `household/`; the bracketed part is the docs/CALCULATIONS.md
 * row.
 *
 * Every figure is worked by hand from the owner's rules, never read from
 * `src/`:
 * - Gain `G = E − B − C + D − R + F` (DESIGN § ESPP Accounting 6) and
 *   Return % `G / (B + (C + R − D − F) / 2)` (DESIGN § Return %); a rollup
 *   sums its rows and a transfer inside it nets to 0 (S45, S46).
 * - The ESPP wire is a negative rollover on the ESPP row and a positive one
 *   on the destination (DESIGN § ESPP Accounting 4–5).
 * - Edits (DESIGN § Data Model 4, Performance account edits): a balanced
 *   row's gain follows its ending, a row with a gap keeps its gain; a
 *   changed ending moves next year's beginning, whose gain follows only if
 *   that row balanced; a finalized year takes only the edit's change, as
 *   do every later year's lifetime totals, never re-summed (S79–S83).
 * - Finalizing: `lifetime(y) = lifetime(y − 1) + G(y)`, next year begins
 *   at this year's ending (DESIGN § Finalization Flow; S75, S77).
 *
 * C74 ("baseline kept, never re-summed": stored years sum to less than the
 * lifetime baseline, an edit moves the lifetime by the change only) is
 * already covered by `tests/routers/performance-rollups.test.ts` ("an
 * account edit moves its category, Portfolio and later lifetime totals by
 * the change": Portfolio lifetime 9,275 from a 9,350 baseline) and isn't
 * repeated here.
 *
 * Inputs: invented accounts and years.
 */
import "./setup-mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema-sqlite";
import { createTestCaller, seedPerformanceAccount } from "./setup";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

type Ctx = Awaited<ReturnType<typeof createTestCaller>>;
let t: Ctx;

beforeEach(async () => {
  t = await createTestCaller();
});
afterEach(() => t.cleanup());

const flows = {
  totalContributions: "0",
  employerContributions: "0",
  distributions: "0",
  fees: "0",
  rollovers: "0",
};

function acctRow(
  year: number,
  performanceAccountId: number,
  parentCategory: string,
  v: Partial<typeof schema.accountPerformance.$inferInsert>,
) {
  return t.db
    .insert(schema.accountPerformance)
    .values({
      year,
      institution: "Inst",
      accountLabel: `acct ${performanceAccountId}`,
      parentCategory,
      performanceAccountId,
      beginningBalance: "0",
      yearlyGainLoss: "0",
      endingBalance: "0",
      ...flows,
      ...v,
    })
    .returning({ id: schema.accountPerformance.id })
    .get().id;
}

function annual(
  year: number,
  category: string,
  v: Partial<typeof schema.annualPerformance.$inferInsert>,
) {
  t.db
    .insert(schema.annualPerformance)
    .values({
      year,
      category,
      beginningBalance: "0",
      totalContributions: "0",
      yearlyGainLoss: "0",
      endingBalance: "0",
      lifetimeGains: "0",
      lifetimeContributions: "0",
      lifetimeMatch: "0",
      ...v,
    })
    .run();
}

const accountRow = (id: number) =>
  t.db
    .select()
    .from(schema.accountPerformance)
    .where(eq(schema.accountPerformance.id, id))
    .get()!;

const rollup = (year: number, category: string) =>
  t.db
    .select()
    .from(schema.annualPerformance)
    .where(
      and(
        eq(schema.annualPerformance.year, year),
        eq(schema.annualPerformance.category, category),
      ),
    )
    .get();

const n = (v: string | null | undefined) => Number(v);
/** Half of 0.01%: a percent shown to two places (four for C79). */
const PCT = 0.00005;

describe("household: an edit's gain and next year's beginning", () => {
  /** A balanced 2030 row (B 100, C 10, G 10, E 120: 100 + 10 + 10) or one
   *  with a gap (G 7), and a 2031 row that balances (G 10) or doesn't (12). */
  function twoYears(g2030: number, g2031: number) {
    const k = seedPerformanceAccount(t.db, {
      accountType: "401k",
      accountLabel: "K",
    });
    const r1 = acctRow(2030, k, "Retirement", {
      beginningBalance: "100",
      totalContributions: "10",
      yearlyGainLoss: String(g2030),
      endingBalance: "120",
    });
    const r2 = acctRow(2031, k, "Retirement", {
      beginningBalance: "120",
      yearlyGainLoss: String(g2031),
      endingBalance: "130",
    });
    return { r1, r2 };
  }
  const editEnding = (id: number, dryRun = false) =>
    t.caller.performance.updateAccount({
      id,
      endingBalance: "125",
      chainNextYear: true,
      dryRun,
    });

  it("household/C75 [HH-09] a balanced row, E 120 → 125: G 15", async () => {
    // 125 − 100 − 10 = 15: the row balanced, so its gain follows.
    const { r1 } = twoYears(10, 10);
    await editEnding(r1);
    expect(n(accountRow(r1).yearlyGainLoss)).toBe(15);
  });

  it("household/C76 [HH-09] a row with a gap, E 120 → 125: G stays 7", async () => {
    // 120 − 100 − 10 = 10 ≠ 7: a deliberate gap, kept.
    const { r1 } = twoYears(7, 12);
    await editEnding(r1);
    expect(n(accountRow(r1).yearlyGainLoss)).toBe(7);
  });

  it("household/C77 [HH-09] next year balanced (B 120, E 130, G 10): B 125, G 5", async () => {
    // Next year begins at the new ending, 125; it balanced (130 − 120 =
    // 10), so its gain follows: 130 − 125 = 5.
    const { r1, r2 } = twoYears(10, 10);
    await editEnding(r1);
    expect(n(accountRow(r2).beginningBalance)).toBe(125);
    expect(n(accountRow(r2).yearlyGainLoss)).toBe(5);
  });

  it("household/C78 [HH-09] next year with a gap (B 120, E 130, G 12): B 125, G stays 12", async () => {
    // 130 − 120 = 10 ≠ 12: a gap, kept; the beginning still follows.
    const { r1, r2 } = twoYears(10, 12);
    await editEnding(r1);
    expect(n(accountRow(r2).beginningBalance)).toBe(125);
    expect(n(accountRow(r2).yearlyGainLoss)).toBe(12);
  });

  it("household/C83 [HH-09] a dry run changes nothing and previews exactly what saving does", async () => {
    // S83: the preview runs the same path and rolls back.
    const { r1, r2 } = twoYears(10, 10);
    const before = [accountRow(r1), accountRow(r2)];
    const dry = await editEnding(r1, true);
    expect([accountRow(r1), accountRow(r2)]).toEqual(before);
    const saved = await editEnding(r1);
    expect(dry.preview).not.toBeNull();
    expect(dry.preview!.accounts).toEqual(saved.preview!.accounts);
    expect(dry.preview!.rollups).toEqual(saved.preview!.rollups);
    // What it listed is what landed (C75, C77).
    expect(n(accountRow(r1).yearlyGainLoss)).toBe(15);
    expect(n(accountRow(r2).beginningBalance)).toBe(125);
  });
});

describe("household: lifetime totals across finalized years", () => {
  /**
   * Three finalized years on a 401(k) of 100,000 at the start, with
   * lifetime gains of 40,000 from before tracking began (a 2029 baseline),
   * gains 5,000, 7,000 and −2,000 in 2030–2032, each year finalized
   * through the router; 2033 is the open year it creates.
   */
  async function threeFinalizedYears() {
    const k = seedPerformanceAccount(t.db, {
      accountType: "401k",
      accountLabel: "K",
    });
    for (const category of ["401k/IRA", "Portfolio"])
      annual(2029, category, {
        isFinalized: true,
        isImmutable: true,
        beginningBalance: "100000",
        endingBalance: "100000",
        lifetimeGains: "40000",
      });
    const ids: Record<number, number> = {};
    ids[2030] = acctRow(2030, k, "Retirement", {
      beginningBalance: "100000",
      yearlyGainLoss: "0",
      endingBalance: "100000",
      isActive: true,
    });
    const gains: Record<number, number> = {
      2030: 5_000,
      2031: 7_000,
      2032: -2_000,
    };
    for (const year of [2030, 2031, 2032]) {
      if (year > 2030)
        ids[year] = t.db
          .select()
          .from(schema.accountPerformance)
          .where(
            and(
              eq(schema.accountPerformance.year, year),
              eq(schema.accountPerformance.performanceAccountId, k),
            ),
          )
          .get()!.id;
      // The row balances (B = E, G 0), so setting the ending sets the gain.
      const b = n(accountRow(ids[year]!).beginningBalance);
      await t.caller.performance.updateAccount({
        id: ids[year]!,
        endingBalance: String(b + gains[year]!),
      });
      await t.caller.performance.finalizeYear({ year });
    }
    return ids;
  }
  const lifetime = (category: string) =>
    [2030, 2031, 2032, 2033].map((y) => n(rollup(y, category)?.lifetimeGains));

  it("household/C72 [HH-09] baseline 40,000, gains 5,000, 7,000, −2,000: 45,000, 52,000, 50,000", async () => {
    // 40,000 + 5,000 = 45,000; + 7,000 = 52,000; − 2,000 = 50,000 (S77);
    // the open 2033 carries 50,000 with no gain of its own yet.
    await threeFinalizedYears();
    expect(lifetime("401k/IRA")).toEqual([45_000, 52_000, 50_000, 50_000]);
    expect(lifetime("Portfolio")).toEqual([45_000, 52_000, 50_000, 50_000]);
  });

  it("household/C73 [HH-09] the middle year's gain edited 7,000 → 8,000: 45,000, 53,000, 51,000", async () => {
    // +1,000 from 2031 on, never re-summed (S79): 45,000; 53,000; 51,000;
    // 2033 51,000. The year's own gain is 8,000 in its category and in
    // Portfolio.
    const ids = await threeFinalizedYears();
    await t.caller.performance.updateAccount({
      id: ids[2031]!,
      endingBalance: String(105_000 + 8_000),
    });
    expect(n(accountRow(ids[2031]!).yearlyGainLoss)).toBe(8_000);
    expect(lifetime("401k/IRA")).toEqual([45_000, 53_000, 51_000, 51_000]);
    expect(lifetime("Portfolio")).toEqual([45_000, 53_000, 51_000, 51_000]);
    expect(n(rollup(2031, "401k/IRA")!.yearlyGainLoss)).toBe(8_000);
    expect(n(rollup(2031, "Portfolio")!.yearlyGainLoss)).toBe(8_000);
  });

  it("household/C80 [HH-09] a two-account Portfolio, account A's gain +500: category, Portfolio and later lifetime +500", async () => {
    // A 401(k) (B 10,000, G 1,000, E 11,000) and a brokerage (B 4,000,
    // G 200, E 4,200) in a finalized 2030; 2031 open. A's ending +500 →
    // its gain 1,500 (balanced); 401k/IRA G 1,000 → 1,500; Portfolio G
    // 1,200 → 1,700; lifetime gains move by 500 in 2030 and in 2031.
    const a = seedPerformanceAccount(t.db, {
      accountType: "401k",
      accountLabel: "A",
    });
    const b = seedPerformanceAccount(t.db, {
      accountType: "brokerage",
      parentCategory: "Portfolio",
      accountLabel: "B",
    });
    const aRow = acctRow(2030, a, "Retirement", {
      beginningBalance: "10000",
      yearlyGainLoss: "1000",
      endingBalance: "11000",
    });
    acctRow(2030, b, "Portfolio", {
      beginningBalance: "4000",
      yearlyGainLoss: "200",
      endingBalance: "4200",
    });
    const locked = { isFinalized: true, isImmutable: true };
    annual(2030, "401k/IRA", {
      ...locked,
      beginningBalance: "10000",
      yearlyGainLoss: "1000",
      endingBalance: "11000",
      lifetimeGains: "1000",
    });
    annual(2030, "Brokerage", {
      ...locked,
      beginningBalance: "4000",
      yearlyGainLoss: "200",
      endingBalance: "4200",
      lifetimeGains: "200",
    });
    annual(2030, "Portfolio", {
      ...locked,
      beginningBalance: "14000",
      yearlyGainLoss: "1200",
      endingBalance: "15200",
      lifetimeGains: "1200",
    });
    annual(2031, "401k/IRA", { lifetimeGains: "1000", isCurrentYear: true });
    annual(2031, "Portfolio", { lifetimeGains: "1200", isCurrentYear: true });

    await t.caller.performance.updateAccount({
      id: aRow,
      endingBalance: "11500",
    });
    expect(n(accountRow(aRow).yearlyGainLoss)).toBe(1_500);
    expect(n(rollup(2030, "401k/IRA")!.yearlyGainLoss)).toBe(1_500);
    expect(n(rollup(2030, "Portfolio")!.yearlyGainLoss)).toBe(1_700);
    expect(n(rollup(2030, "Brokerage")!.yearlyGainLoss)).toBe(200);
    expect(n(rollup(2030, "Portfolio")!.lifetimeGains)).toBe(1_700);
    expect(n(rollup(2031, "401k/IRA")!.lifetimeGains)).toBe(1_500);
    expect(n(rollup(2031, "Portfolio")!.lifetimeGains)).toBe(1_700);
  });
});

describe("household: the ESPP transfer", () => {
  /** An ESPP (B 5,000, C 10,000 of which 1,500 discount, wired out 12,000,
   *  E 3,500) and the brokerage it wires to (B 20,000, in 12,000, E 33,000),
   *  both Portfolio, in an open 2030. */
  async function summary() {
    const espp = seedPerformanceAccount(t.db, {
      accountType: "brokerage",
      subType: "ESPP",
      parentCategory: "Portfolio",
      accountLabel: "E",
    });
    const dest = seedPerformanceAccount(t.db, {
      accountType: "brokerage",
      parentCategory: "Portfolio",
      accountLabel: "D",
    });
    acctRow(2030, espp, "Portfolio", {
      beginningBalance: "5000",
      totalContributions: "10000",
      employerContributions: "1500",
      rollovers: "-12000",
      yearlyGainLoss: "500",
      endingBalance: "3500",
    });
    acctRow(2030, dest, "Portfolio", {
      beginningBalance: "20000",
      rollovers: "12000",
      yearlyGainLoss: "1000",
      endingBalance: "33000",
    });
    annual(2030, "Brokerage", { isCurrentYear: true });
    annual(2030, "Portfolio", { isCurrentYear: true });
    const s = await t.caller.performance.computeSummary();
    const account = (id: number) =>
      s.accountRows.find((r) => r.performanceAccountId === id)!;
    const category = (c: string) =>
      s.annualRows.find((r) => r.year === 2030 && r.category === c)!;
    return { espp: account(espp), dest: account(dest), category };
  }

  it("household/C52 [HH-07] the ESPP row (B 5,000, C 10,000, R −12,000, E 3,500): G 500, 12.50%", async () => {
    // G = 3,500 − 5,000 − 10,000 + 12,000 = 500; 5,000 + (10,000 −
    // 12,000)/2 = 4,000; 500 / 4,000 = 12.50%.
    const { espp } = await summary();
    expect(espp.yearlyGainLoss).toBe(500);
    expect(Math.abs(espp.annualReturnPct! - 0.125)).toBeLessThan(PCT);
  });

  it("household/C53 [HH-09] the destination (B 20,000, R +12,000, E 33,000): G 1,000, 3.85%; Brokerage and Portfolio R 0, G 1,500, 5.00%", async () => {
    // G = 33,000 − 20,000 − 12,000 = 1,000; 20,000 + 12,000/2 = 26,000;
    // 1,000 / 26,000 = 3.8462%. Rolled up: B 25,000, C 10,000, R 0
    // (−12,000 + 12,000), G 1,500, E 36,500; 1,500 / (25,000 + 10,000/2)
    // = 1,500 / 30,000 = 5.00% (S46).
    const { dest, category } = await summary();
    expect(dest.yearlyGainLoss).toBe(1_000);
    expect(Math.abs(dest.annualReturnPct! - 1_000 / 26_000)).toBeLessThan(PCT);
    for (const c of ["Brokerage", "Portfolio"]) {
      const r = category(c);
      expect(r.rollovers, c).toBe(0);
      expect(r.yearlyGainLoss, c).toBe(1_500);
      expect(Math.abs(r.annualReturnPct! - 0.05), c).toBeLessThan(PCT);
    }
  });
});

describe("household: finalizing a year", () => {
  it("household/C79 [HH-55] finalize 2024 (E 150,000): 2025 begins at 150,000 and is the current year; 2024 3.5088%", async () => {
    // B 140,000, C 5,000, G 5,000, E 150,000: 5,000 / (140,000 + 5,000/2)
    // = 5,000 / 142,500 = 3.5088%. Next year's rows begin at the ending
    // (DESIGN § Finalization Flow; S75). Closes the verdicts' survivor m18.
    const k = seedPerformanceAccount(t.db, {
      accountType: "401k",
      accountLabel: "K",
    });
    acctRow(2024, k, "Retirement", {
      beginningBalance: "140000",
      totalContributions: "5000",
      yearlyGainLoss: "5000",
      endingBalance: "150000",
      isActive: true,
    });
    await t.caller.performance.finalizeYear({ year: 2024 });
    const next = t.db
      .select()
      .from(schema.accountPerformance)
      .where(eq(schema.accountPerformance.year, 2025))
      .all();
    expect(next.map((r) => n(r.beginningBalance))).toEqual([150_000]);
    const cat2025 = rollup(2025, "401k/IRA")!;
    expect(n(cat2025.beginningBalance)).toBe(150_000);
    expect(cat2025.isCurrentYear).toBe(true);
    const cat2024 = rollup(2024, "401k/IRA")!;
    expect(cat2024.isFinalized).toBe(true);
    expect(cat2024.isCurrentYear).toBe(false);
    expect(Math.abs(n(cat2024.annualReturnPct) - 5_000 / 142_500)).toBeLessThan(
      0.000005,
    );
  });
});
