/**
 * Milestones router integration test — computeInputs maps the year-end
 * history and returns the saved goals/checklist, validated.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema-sqlite";
import { SK_ACTIVE_CONTRIB_PROFILE_ID } from "@/lib/constants/settings-keys";
import { buildMilestoneInput } from "@/lib/pure/advice/milestones/input";
import { evaluateMilestones } from "@/lib/pure/advice/milestones/milestones";
import { effectiveHighIncomeLine } from "@/lib/pure/paycheck/high-income-line";
import {
  createTestCaller,
  seedPerson,
  seedJob,
  seedPerformanceAccount,
  seedSnapshot,
  seedAppSetting,
  seedContributionAccount,
  seedContributionProfile,
  viewerSession,
} from "./setup";

describe("milestones.computeInputs", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller(viewerSession);
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    const personId = await seedPerson(db, "Test Person", "1990-01-01");
    seedJob(db, personId);
    const retirement = seedPerformanceAccount(db, {
      accountLabel: "401k",
      institution: "Fidelity",
      accountType: "401k",
    });
    const brokerage = seedPerformanceAccount(db, {
      accountLabel: "Brokerage",
      institution: "Schwab",
      accountType: "brokerage",
      parentCategory: "Portfolio",
    });
    seedSnapshot(db, "2025-01-15", [
      { performanceAccountId: retirement, amount: "100000", taxType: "preTax" },
      { performanceAccountId: brokerage, amount: "50000", taxType: "afterTax" },
    ]);
    // Two finalized years with a raise between them; this year's row (not
    // finalized, and the current year) never counts.
    const thisYear = new Date().getFullYear();
    for (const [year, salary] of [
      [thisYear - 2, 100_000],
      [thisYear - 1, 110_000],
      [thisYear, 150_000],
    ] as const)
      db.insert(schema.historicalSalaries)
        .values({ personId, year, salary: String(salary) })
        .run();
    // Last year lost money: a down year for Always Be Buying.
    for (const [year, total, employer, finalized, gain] of [
      [thisYear - 2, 25_000, 5_000, true, 8_000],
      [thisYear - 1, 32_000, 5_000, true, -5_000],
      [thisYear, 40_000, 5_000, false, -1_000],
    ] as const)
      db.insert(schema.accountPerformance)
        .values({
          year,
          institution: "Fidelity",
          accountLabel: "401k",
          ownerPersonId: personId,
          parentCategory: "Retirement",
          performanceAccountId: retirement,
          beginningBalance: "0",
          totalContributions: String(total),
          employerContributions: String(employer),
          yearlyGainLoss: String(gain),
          endingBalance: "0",
          isFinalized: finalized,
        })
        .run();
    // A student loan opened two years ago, and an open car loan.
    db.insert(schema.debts)
      .values([
        {
          name: "School",
          kind: "student_loan",
          ownerPersonId: personId,
          balance: "20000",
          balanceAsOf: `${thisYear}-01-01`,
          originalAmount: "40000",
          openedDate: `${thisYear - 2}-09-01`,
        },
        {
          name: "Car",
          kind: "auto_loan",
          ownerPersonId: personId,
          balance: "15000",
          balanceAsOf: `${thisYear}-01-01`,
          originalAmount: "24000",
          purchasePrice: "30000",
          termMonths: 36,
          monthlyPayment: "700",
        },
      ])
      .run();
    seedAppSetting(db, "milestone_checklist", { will: true });
    // Stored before validation existed / hand-edited: read back as empty.
    seedAppSetting(db, "milestone_custom_goals", [{ id: "x" }]);
  });

  afterAll(() => cleanup());

  it("returns the current year with liquid split into retirement and brokerage", async () => {
    const result = await caller.milestones.computeInputs({});
    const current = result.years[result.years.length - 1]!;
    expect(current.isCurrent).toBe(true);
    expect(current.retirement).toBe(100000);
    expect(current.brokerage).toBe(50000);
    expect(current.liquid).toBe(150000 + current.cash);
    expect(current.contributions).toBeNull();
    expect(result.asOfYear).toBe(new Date().getFullYear());
  });

  it("returns each raise: own contributions (employer money out) against salary, past finalized years only", async () => {
    const result = await caller.milestones.computeInputs({});
    const thisYear = new Date().getFullYear();
    expect(result.raises).toEqual([
      {
        year: thisYear - 1,
        raise: 10_000,
        savingChange: 7_000,
        share: 0.7,
        estimated: false,
      },
    ]);
  });

  it("returns each losing past year with own contributions against the year before", async () => {
    const result = await caller.milestones.computeInputs({});
    const thisYear = new Date().getFullYear();
    expect(result.downYears).toEqual([
      {
        year: thisYear - 1,
        gain: -5_000,
        contributed: 27_000,
        prior: 20_000,
        heldUp: true,
      },
    ]);
  });

  it("returns the borrowing inputs: open car loans and each person's student loans against their first full salary", async () => {
    const result = await caller.milestones.computeInputs({});
    const thisYear = new Date().getFullYear();
    expect(result.borrowing).toEqual({
      carLoans: [
        {
          name: "Car",
          purchasePrice: 30_000,
          originalAmount: 24_000,
          termMonths: 36,
          monthlyPayment: 700,
        },
      ],
      studentLoans: [
        {
          owner: "Test Person",
          totalOriginal: 40_000,
          loanYear: thisYear - 2,
          firstSalary: { year: thisYear - 2, salary: 100_000 },
        },
      ],
      jointStudentLoans: 0,
    });
  });

  it("returns the validated checklist and drops unreadable goals", async () => {
    const result = await caller.milestones.computeInputs({});
    expect(result.checklist).toEqual({ will: true });
    expect(result.customGoals).toEqual([]);
  });
});

describe("milestones.recordReached", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;

  beforeAll(async () => {
    ctx = await createTestCaller(viewerSession);
    const personId = await seedPerson(ctx.db, "Test Person", "1990-01-01");
    seedJob(ctx.db, personId);
  });
  afterAll(() => ctx.cleanup());

  it("a viewer's visit records; what was already reached stays undated", async () => {
    expect(await ctx.caller.milestones.getFirstReached()).toBeNull();
    const first = await ctx.caller.milestones.recordReached();
    expect(first?.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Nothing reached before recording began gets a day.
    expect(Object.values(first!.reached).every((v) => v.length !== 10)).toBe(
      true,
    );
    expect(await ctx.caller.milestones.getFirstReached()).toEqual(first);
    // Bookkeeping, not an edit: nothing in the change log.
    expect(ctx.db.select().from(schema.changeLog).all()).toEqual([]);
  });

  it("nothing new: nothing written", async () => {
    expect(await ctx.caller.milestones.recordReached()).toBeNull();
  });

  it("one reached after recording began gets today's date", async () => {
    const stored = (await ctx.caller.milestones.getFirstReached())!;
    const [id] = Object.keys(stored.reached);
    expect(id).toBeDefined();
    const { [id!]: _dropped, ...rest } = stored.reached;
    ctx.db
      .update(schema.appSettings)
      .set({ value: { since: stored.since, reached: rest } })
      .where(eq(schema.appSettings.key, "milestone_first_reached"))
      .run();
    const next = await ctx.caller.milestones.recordReached();
    expect(next?.reached[id!]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("milestones.recordReached on a household with contributions", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  let contributionProfileId: number;

  beforeAll(async () => {
    ctx = await createTestCaller(viewerSession);
    const personId = await seedPerson(ctx.db, "Test Person", "1990-01-01");
    const jobId = seedJob(ctx.db, personId);
    // $36,000 a year (30%) on a $120,000 salary: $20,000 to a 401k, the
    // rest to a brokerage account.
    const plan = seedContributionAccount(ctx.db, { personId, jobId });
    const brokerage = seedContributionAccount(ctx.db, {
      personId,
      accountType: "brokerage",
      parentCategory: "Portfolio",
      taxTreatment: "after_tax",
    });
    const annual = (value: string) => ({
      contributionMethod: "fixed_annual",
      contributionValue: value,
    });
    contributionProfileId = seedContributionProfile(ctx.db, {
      contributionActiveFields: {
        contributionAccounts: {
          [plan]: annual("20000"),
          [brokerage]: annual("16000"),
        },
      },
    });
    ctx.db
      .insert(schema.appSettings)
      .values({
        key: SK_ACTIVE_CONTRIB_PROFILE_ID,
        value: String(contributionProfileId),
      })
      .onConflictDoUpdate({
        target: schema.appSettings.key,
        set: { value: String(contributionProfileId) },
      })
      .run();
  });
  afterAll(() => ctx.cleanup());

  it("records the same reached set the page judges on the active profiles", async () => {
    const { caller } = ctx;
    const [inputs, contributions, savings, mortgage, line] = await Promise.all([
      caller.milestones.computeInputs({}),
      caller.contribution.computeSummary({ contributionProfileId }),
      caller.savings.computeSummary(),
      caller.mortgage.computeActiveSummary(),
      caller.contribution.computeHighIncomeLine(),
    ]);
    const efund = savings.efund;
    const pageReached = evaluateMilestones(
      buildMilestoneInput({
        inputs,
        contributions,
        highIncomeThreshold: effectiveHighIncomeLine(null, line.threshold),
        efundMonths: efund
          ? (efund.monthsCoveredWithRepay ?? efund.monthsCovered)
          : null,
        efundEssentialMonthly:
          efund && efund.targetMonths > 0
            ? efund.targetAmount / efund.targetMonths
            : null,
        mortgage,
        projection: null,
        holdings: null,
        buyingMonths: null,
        brokerageGoals: null,
      }),
    )
      .filter((r) => r.status === "reached")
      .map((r) => r.id)
      .sort();
    // Reached only when contributions count.
    expect(pageReached).toContain("savingsRate");

    const recorded = await caller.milestones.recordReached();
    expect(Object.keys(recorded!.reached).sort()).toEqual(pageReached);
  });
});
