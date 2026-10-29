/**
 * This year's income counts every job a person had in it, each for the
 * checks it pays inside the year: the current job from its start date,
 * plus a job that ended this year. Invented household only.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema-sqlite";
import { createTestCaller, seedJob, seedPerson } from "./setup";
import {
  checksPaidYtd,
  householdWithheldSoFar,
  periodsBeforeStart,
  withheldThroughPeriod,
} from "@/lib/calculators/paycheck";

const NOW = new Date("2026-08-14T12:00:00");
const NEW_START = "2026-06-01";
const OLD_END = "2026-05-22";

describe("paycheck: a person who changed jobs this year", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    ctx = await createTestCaller();
    const personId = await seedPerson(ctx.db, "Example Mover", "1988-02-10");
    ctx.db
      .update(schema.people)
      .set({ isPrimaryUser: true })
      .where(eq(schema.people.id, personId))
      .run();
    seedJob(ctx.db, personId, {
      employerName: "Old Co",
      annualSalary: "78000",
      payPeriod: "biweekly",
      payWeek: "even",
      anchorPayDate: "2026-01-09",
      startDate: "2019-04-01",
      endDate: OLD_END,
    });
    seedJob(ctx.db, personId, {
      employerName: "New Co",
      annualSalary: "104000",
      payPeriod: "biweekly",
      payWeek: "even",
      anchorPayDate: "2026-06-05",
      startDate: NEW_START,
    });
  });
  afterAll(() => {
    ctx.cleanup();
    vi.useRealTimers();
  });

  it("counts each job's checks inside the year, and says nothing is missing", async () => {
    const s = await ctx.caller.paycheck.computeSummary();
    const newChecks =
      26 - periodsBeforeStart(NOW, "biweekly", "2026-06-05", NEW_START);
    const oldChecks = checksPaidYtd(
      new Date(`${OLD_END}T12:00:00Z`),
      "biweekly",
      "2026-01-09",
      26,
      "2019-04-01",
    );
    expect(newChecks).toBeLessThan(26);
    expect(oldChecks).toBeGreaterThan(0);
    expect(s.householdIncome!.salary).toBeCloseTo(
      (104_000 * newChecks + 78_000 * oldChecks) / 26,
      0,
    );
    expect(s.people[0]!).toMatchObject({ yearPayNote: null });
  });

  it("withheld so far adds what the old job withheld to the new job's checks", async () => {
    const s = await ctx.caller.paycheck.computeSummary();
    const p = s.people[0]!;
    const current = withheldThroughPeriod(
      p.paycheck!.yearSchedule,
      p.paycheck!.periodsElapsedYtd,
    );
    const ended = "endedWithheld" in p ? p.endedWithheld : null;
    expect(ended!.federal).toBeGreaterThan(0);
    expect(ended!.fica).toBeGreaterThan(0);
    const all = householdWithheldSoFar(s.people);
    expect(all.federal).toBeCloseTo(current.federal + ended!.federal, 2);
    expect(all.fica).toBeCloseTo(current.fica + ended!.fica, 2);
  });
});

describe("paycheck: a job started this year, no earlier job in Ledgr", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    ctx = await createTestCaller();
    const personId = await seedPerson(ctx.db, "Example Starter", "1990-07-01");
    seedJob(ctx.db, personId, {
      employerName: "New Co",
      annualSalary: "104000",
      payPeriod: "biweekly",
      payWeek: "even",
      anchorPayDate: "2026-06-05",
      startDate: NEW_START,
    });
  });
  afterAll(() => {
    ctx.cleanup();
    vi.useRealTimers();
  });

  it("counts the job from its start and says pay before it isn't counted", async () => {
    const s = await ctx.caller.paycheck.computeSummary();
    const checks =
      26 - periodsBeforeStart(NOW, "biweekly", "2026-06-05", NEW_START);
    expect(s.householdIncome!.salary).toBeCloseTo((104_000 * checks) / 26, 0);
    expect(s.people[0]!).toMatchObject({
      yearPayNote: { startDate: NEW_START, missingEndedJob: false },
    });
    // The year-end estimate counts its checks from its start.
    const p = s.people[0]!;
    expect("blendedAnnual" in p && p.blendedAnnual!.segments).toEqual([
      expect.objectContaining({ periods: checks }),
    ]);
  });
});

describe("paycheck: no job now, one that ended this year", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    ctx = await createTestCaller();
    const personId = await seedPerson(ctx.db, "Example Retiree", "1961-01-15");
    seedJob(ctx.db, personId, {
      employerName: "Last Co",
      annualSalary: "90000",
      payPeriod: "biweekly",
      payWeek: "even",
      anchorPayDate: "2026-01-09",
      startDate: "2010-03-01",
      endDate: OLD_END,
    });
  });
  afterAll(() => {
    ctx.cleanup();
    vi.useRealTimers();
  });

  it("still earned this year: the household income and tax count it", async () => {
    const s = await ctx.caller.paycheck.computeSummary();
    const checks = checksPaidYtd(
      new Date(`${OLD_END}T12:00:00Z`),
      "biweekly",
      "2026-01-09",
      26,
      "2010-03-01",
    );
    expect(s.people[0]!.paycheck).toBeNull();
    expect(s.householdIncome!.salary).toBeCloseTo((90_000 * checks) / 26, 0);
    expect(s.householdTax).not.toBeNull();
    // Its checks withheld Social Security + Medicare on every dollar (no
    // pre-tax money, under the wage base), and federal tax.
    const withheld = householdWithheldSoFar(s.people);
    expect(withheld.fica).toBeCloseTo(((90_000 * checks) / 26) * 0.0765, 0);
    expect(withheld.federal).toBeGreaterThan(0);
  });
});

describe("paycheck: a job whose last day is later this year", () => {
  const LAST_DAY = "2026-11-20";
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    ctx = await createTestCaller();
    const personId = await seedPerson(ctx.db, "Example Leaver", "1962-05-05");
    seedJob(ctx.db, personId, {
      employerName: "Leaving Co",
      annualSalary: "90000",
      payPeriod: "biweekly",
      payWeek: "even",
      anchorPayDate: "2026-01-09",
      startDate: "2012-03-01",
      endDate: LAST_DAY,
    });
  });
  afterAll(() => {
    ctx.cleanup();
    vi.useRealTimers();
  });

  it("withheld so far stops at today; the year's income runs to its last day", async () => {
    const s = await ctx.caller.paycheck.computeSummary();
    const toDate = checksPaidYtd(NOW, "biweekly", "2026-01-09", 26, null);
    const toEnd = checksPaidYtd(
      new Date(`${LAST_DAY}T12:00:00Z`),
      "biweekly",
      "2026-01-09",
      26,
      "2012-03-01",
    );
    expect(toEnd).toBeGreaterThan(toDate);
    // Still the current job: its paycheck shows, counted once (not also
    // as a job that ended this year).
    const p = s.people[0]!;
    expect(p.paycheck).not.toBeNull();
    expect(p.job).toMatchObject({ employerName: "Leaving Co" });
    expect("endedWithheld" in p && p.endedWithheld).toEqual({
      federal: 0,
      fica: 0,
    });
    expect(s.householdIncome!.salary).toBeCloseTo((90_000 * toEnd) / 26, 0);
    // The year-end estimate stops at its last day too.
    const blended = "blendedAnnual" in p ? p.blendedAnnual : null;
    expect(blended!.segments).toEqual([
      expect.objectContaining({ periods: toEnd }),
    ]);
    expect(householdWithheldSoFar(s.people).fica).toBeCloseTo(
      ((90_000 * toDate) / 26) * 0.0765,
      0,
    );
  });
});

describe("paycheck: a job that hasn't started", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    ctx = await createTestCaller();
    const personId = await seedPerson(ctx.db, "Example Joiner", "1995-09-09");
    seedJob(ctx.db, personId, {
      employerName: "Next Co",
      annualSalary: "80000",
      payPeriod: "biweekly",
      payWeek: "even",
      anchorPayDate: "2027-01-08",
      startDate: "2027-01-04",
    });
  });
  afterAll(() => {
    ctx.cleanup();
    vi.useRealTimers();
  });

  it("no paycheck yet: says when it starts, and counts no pay", async () => {
    const s = await ctx.caller.paycheck.computeSummary();
    const p = s.people[0]!;
    expect(p.paycheck).toBeNull();
    expect(p).toMatchObject({
      upcomingJob: { employerName: "Next Co", startDate: "2027-01-04" },
    });
    expect(s.householdIncome?.salary ?? 0).toBe(0);
  });
});

describe("paycheck: a bonus with no date on a job ending this year", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    ctx = await createTestCaller();
    const undated = await seedPerson(ctx.db, "Example Undated", "1962-05-05");
    seedJob(ctx.db, undated, {
      employerName: "Undated Co",
      annualSalary: "90000",
      bonusPercent: "0.10",
      payPeriod: "biweekly",
      payWeek: "even",
      anchorPayDate: "2026-01-09",
      startDate: "2012-03-01",
      endDate: "2026-11-20",
    });
    const dated = await seedPerson(ctx.db, "Example Dated", "1964-07-07");
    seedJob(ctx.db, dated, {
      employerName: "Dated Co",
      annualSalary: "80000",
      bonusPercent: "0.10",
      bonusMonth: 3,
      bonusDayOfMonth: 15,
      payPeriod: "biweekly",
      payWeek: "even",
      anchorPayDate: "2026-01-09",
      startDate: "2010-01-04",
      endDate: "2026-11-20",
    });
    const left = await seedPerson(ctx.db, "Example Left", "1966-09-09");
    seedJob(ctx.db, left, {
      employerName: "Left Co",
      annualSalary: "70000",
      bonusPercent: "0.10",
      payPeriod: "biweekly",
      payWeek: "even",
      anchorPayDate: "2026-01-09",
      startDate: "2015-01-05",
      endDate: OLD_END,
    });
  });
  afterAll(() => {
    ctx.cleanup();
    vi.useRealTimers();
  });

  it("says the undated bonus isn't counted; a dated one before the last day is", async () => {
    const s = await ctx.caller.paycheck.computeSummary();
    const byName = new Map(s.people.map((p) => [p.person.name, p]));
    const notCounted = (name: string) => {
      const p = byName.get(name)!;
      return "bonusNotCounted" in p ? p.bonusNotCounted : undefined;
    };
    expect(notCounted("Example Undated")).toEqual(["Undated Co"]);
    expect(notCounted("Example Dated")).toEqual([]);
    // No job now: the ended job's undated bonus is named too.
    expect(notCounted("Example Left")).toEqual(["Left Co"]);
    // Only the dated bonus is in the year's income.
    expect(s.householdIncome!.bonus).toBeCloseTo(8_000, 0);
  });
});
