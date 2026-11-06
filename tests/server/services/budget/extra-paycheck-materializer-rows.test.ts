/**
 * Every row both extra-paycheck materializers write, pinned for one
 * invented household run at several dates: mid-month, a month boundary, the
 * last second of a year, the first of the next, and a year rollover that
 * falls on different days in local time and UTC. The month walk is the real
 * one (nothing mocked), so the pinned rows are exactly what an install gets.
 *
 * The household covers both modes and every way a job is left out: Savings
 * rules with an override, a rule window and growth; a legacy rule with only
 * `netPaySnapshot`; two jobs splitting into one goal on the same months;
 * Budget mode with no rules and with `enabled: false`; Budget mode with no
 * base pay; a speculative, an ended and a monthly-pay job; a job with no
 * Salary Profile entry; a routing whose snapshot anchor is `null`; splits to
 * an inactive goal and to a goal that doesn't exist; a goal linked to a
 * budget category and one that isn't; history, a settled row and manual rows
 * that must survive.
 */
import "../../../helpers/setup-mocks";
import { describe, it, expect, vi, afterEach } from "vitest";
import { asc } from "drizzle-orm";
import type { ExtraPaycheckRoutingData } from "@/lib/db/schema-pg";
import type { SalaryEntry } from "@/lib/db/salary-entry-defaults";
import { BLANK_SALARY_ENTRY } from "@/lib/db/salary-entry-defaults";
import { createTestDb, type TestDbContext } from "../../../helpers/db-harness";
import { materializeExtraPaycheckSavings } from "@/server/services/budget/extra-paycheck-materializer";
import { materializeBudgetIncomeAdjustments } from "@/server/services/budget/budget-income-materializer";
import { SK_ACTIVE_SALARY_PROFILE_ID } from "@/lib/constants/settings-keys";
import EXPECTED from "../../../fixtures/extra-paycheck-materializer-rows.json";

const TRAVEL = 1; // active, linked to a budget category
const HOUSE = 2; // active, not linked
const RETIRED_GOAL = 3; // inactive
const MISSING_GOAL = 99; // no such goal

function entry(
  routing: ExtraPaycheckRoutingData | null,
  schedule: Partial<SalaryEntry> = {},
): SalaryEntry {
  return {
    ...BLANK_SALARY_ENTRY,
    salary: 90000,
    anchorPayDate: "2026-01-02",
    ...schedule,
    extraPaycheckRouting: routing,
  };
}

function seed(ctx: TestDbContext): void {
  const s = ctx.schema;
  ctx.db
    .insert(s.people)
    .values([
      { id: 1, name: "Alex", dateOfBirth: "1988-03-04", isPrimaryUser: true },
      { id: 2, name: "Sam", dateOfBirth: "1990-11-30", isPrimaryUser: false },
    ])
    .run();
  ctx.db
    .insert(s.savingsGoals)
    .values([
      { id: TRAVEL, name: "Travel", isActive: true, apiCategoryId: "cat-1" },
      { id: HOUSE, name: "House", isActive: true },
      { id: RETIRED_GOAL, name: "Old car", isActive: false },
    ])
    .run();
  const job = (id: number, personId: number, extra = {}) => ({
    id,
    personId,
    employerName: `Employer ${id}`,
    startDate: "2020-01-01",
    ...extra,
  });
  ctx.db
    .insert(s.jobs)
    .values([
      job(1, 1),
      job(2, 2),
      job(3, 1),
      job(4, 2),
      job(5, 1),
      job(6, 1, { isSpeculative: true }),
      job(7, 2, { endDate: "2025-12-31" }),
      job(8, 2),
      job(9, 1),
      job(10, 2),
      job(11, 1, { endDate: "2026-12-31" }),
    ])
    .run();

  const salaries: Record<string, SalaryEntry> = {
    // Savings: two rule windows, an override, growth by percent and dollar.
    "1": entry({
      rules: [
        {
          from: "2026-01",
          to: "2027-06",
          splits: [
            { goalId: TRAVEL, pct: 60 },
            { goalId: HOUSE, pct: 40 },
          ],
        },
        {
          from: "2027-07",
          to: null,
          splits: [
            { goalId: TRAVEL, pct: 50 },
            { goalId: RETIRED_GOAL, pct: 30 },
            { goalId: MISSING_GOAL, pct: 20 },
          ],
        },
      ],
      overrides: [{ month: "2026-07", splits: [{ goalId: HOUSE, pct: 100 }] }],
      baseNetPayPerCheck: 2000.13,
      baseYear: 2026,
      yearlyGrowth: {
        "2027": { type: "pct", value: 3 },
        "2028": { type: "dollar", value: 150 },
        "2029": { type: "pct", value: 0 },
        "2031": { type: "pct", value: 2.5 },
      },
    }),
    // Savings, legacy: no base pay, so each rule's netPaySnapshot; the
    // schedule comes from the routing's own snapshot, same months as job 1.
    "2": entry(
      {
        rules: [
          {
            from: "2026-03",
            to: null,
            splits: [{ goalId: TRAVEL, pct: 33.3 }],
            netPaySnapshot: 1777.77,
          },
        ],
        anchorPayDate: "2026-01-16",
        payPeriod: "biweekly",
      },
      { anchorPayDate: "2026-02-20", payPeriod: "monthly" },
    ),
    // Budget mode, no rules; base year earlier than now.
    "3": entry(
      {
        rules: [],
        baseNetPayPerCheck: 1800.4,
        baseYear: 2025,
        yearlyGrowth: { "2026": { type: "pct", value: 4 } },
      },
      { anchorPayDate: "2026-01-09" },
    ),
    // Budget mode by `enabled: false`, rules kept; no base year.
    "4": entry(
      {
        rules: [
          { from: "2026-01", to: null, splits: [{ goalId: HOUSE, pct: 100 }] },
        ],
        enabled: false,
        baseNetPayPerCheck: 900.55,
      },
      { anchorPayDate: "2025-12-26" },
    ),
    // Budget mode with no base pay: nothing to write.
    "5": entry({ rules: [] }),
    // Speculative and ended jobs: left out.
    "6": entry({
      rules: [
        { from: "2026-01", to: null, splits: [{ goalId: TRAVEL, pct: 100 }] },
      ],
      baseNetPayPerCheck: 5000,
    }),
    "7": entry({ rules: [], baseNetPayPerCheck: 5000 }),
    // Monthly pay: no extra paychecks.
    "8": entry(
      { rules: [], baseNetPayPerCheck: 3000 },
      { payPeriod: "monthly" },
    ),
    // Job 9 has no entry. Job 10's snapshot anchor is null, which wins
    // over the live entry's anchor: left out.
    "10": entry({
      rules: [],
      baseNetPayPerCheck: 1200,
      anchorPayDate: null,
      payPeriod: "biweekly",
    }),
    // Ends at the year end: in until the date passes.
    "11": entry(
      {
        rules: [
          { from: "2026-01", to: null, splits: [{ goalId: HOUSE, pct: 100 }] },
        ],
        baseNetPayPerCheck: 1500,
      },
      { anchorPayDate: "2026-01-09" },
    ),
  };
  const [profile] = ctx.db
    .insert(s.salaryProfiles)
    .values({ name: "Household", salaries })
    .returning()
    .all();
  ctx.db
    .insert(s.appSettings)
    .values({ key: SK_ACTIVE_SALARY_PROFILE_ID, value: profile!.id })
    .onConflictDoUpdate({
      target: s.appSettings.key,
      set: { value: profile!.id },
    })
    .run();

  // Rows that must survive: history, a manual future row, a manual budget
  // row for a job neither materializer writes.
  ctx.db
    .insert(s.savingsPlannedTransactions)
    .values([
      {
        goalId: TRAVEL,
        transactionDate: "2026-01-01",
        amount: "1200.00",
        description: "Alex",
        source: "rule",
      },
      {
        goalId: HOUSE,
        transactionDate: "2026-09-01",
        amount: "250.00",
        description: "Gift",
        source: "manual",
      },
    ])
    .run();
  ctx.db
    .insert(s.budgetIncomeAdjustments)
    .values([
      { jobId: 3, monthDate: "2026-01-01", amount: "1872.42", source: "rule" },
      { jobId: 8, monthDate: "2026-08-01", amount: "75.00", source: "manual" },
    ])
    .run();
}

function tables(ctx: TestDbContext) {
  const s = ctx.schema;
  return {
    savings: ctx.db
      .select()
      .from(s.savingsPlannedTransactions)
      .orderBy(asc(s.savingsPlannedTransactions.id))
      .all()
      .map((r) => [
        r.id,
        r.goalId,
        r.transactionDate,
        r.amount,
        r.description,
        r.source,
        r.isRecurring,
        r.recurrenceMonths,
        r.transferPairId,
      ]),
    budget: ctx.db
      .select()
      .from(s.budgetIncomeAdjustments)
      .orderBy(asc(s.budgetIncomeAdjustments.id))
      .all()
      .map((r) => [r.id, r.jobId, r.monthDate, r.amount, r.source]),
    settlements: ctx.db
      .select()
      .from(s.savingsPlannedTxSettlements)
      .orderBy(asc(s.savingsPlannedTxSettlements.id))
      .all()
      .map((r) => [r.plannedTxId, r.occurrenceMonth]),
  };
}

async function runBoth(ctx: TestDbContext, at: string) {
  vi.setSystemTime(new Date(at));
  await materializeExtraPaycheckSavings(ctx.db as never);
  await materializeBudgetIncomeAdjustments(ctx.db as never);
  return { at, ...tables(ctx) };
}

describe("extra-paycheck materializers: the rows they write", () => {
  let ctx: TestDbContext | undefined;
  const tz = process.env.TZ;

  afterEach(() => {
    ctx?.cleanup();
    ctx = undefined;
    process.env.TZ = tz;
    vi.useRealTimers();
  });

  it("writes the same rows at each date, across month and year rollovers", async () => {
    vi.useFakeTimers();
    ctx = await createTestDb();
    seed(ctx);
    const runs = [await runBoth(ctx, "2026-06-15T12:00:00Z")];

    // Settle July's Travel row: it must keep its id and amount.
    const july = ctx.db
      .select()
      .from(ctx.schema.savingsPlannedTransactions)
      .all()
      .find((r) => r.transactionDate === "2026-07-01" && r.source === "rule");
    ctx.db
      .insert(ctx.schema.savingsPlannedTxSettlements)
      .values({ plannedTxId: july!.id, occurrenceMonth: "2026-07-01" })
      .run();

    runs.push(await runBoth(ctx, "2026-07-01T00:00:00Z"));
    runs.push(await runBoth(ctx, "2026-12-31T23:59:59Z"));
    runs.push(await runBoth(ctx, "2027-01-01T00:00:00Z"));
    runs.push(await runBoth(ctx, "2027-07-20T08:30:00Z"));
    expect(runs).toEqual(EXPECTED.utc);
  });

  it("writes the same rows when local time and UTC fall in different years", async () => {
    process.env.TZ = "America/Chicago";
    vi.useFakeTimers();
    ctx = await createTestDb();
    seed(ctx);
    // 21:30 on Dec 31 in Chicago is already Jan 1 in UTC; then the reverse
    // month edge, 23:30 on Jan 31 local.
    const runs = [
      await runBoth(ctx, "2027-01-01T03:30:00Z"),
      await runBoth(ctx, "2027-02-01T05:30:00Z"),
    ];
    expect(runs).toEqual(EXPECTED.local);
  });
});
