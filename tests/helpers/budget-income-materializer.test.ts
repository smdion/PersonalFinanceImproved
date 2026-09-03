/**
 * Budget-income materializer tests.
 *
 * Covers src/server/helpers/budget-income-materializer.ts — the Budget-mode
 * complement of the Savings-mode extra-paycheck materializer. Verifies:
 *  - a Budget-mode job (no rules, or enabled:false) gets one
 *    budget_income_adjustments row per detected extra-paycheck month
 *  - a Savings-mode job (rules + not disabled) gets NONE
 *  - flipping a job's routing mode regenerates the correct table and clears
 *    the other side's stale rows
 *  - rows dated before the current month survive regeneration
 *
 * getExtraPaycheckMonthKeys (the biweekly-3-paycheck-month detector) is
 * mocked — its own correctness is covered by paycheck.test.ts.
 * isExtraPaycheckBudgetMode is the REAL implementation (importActual) since
 * the mode-detection boundary is exactly what this file is exercising.
 */
import "./setup-mocks";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbContext } from "./db-harness";
import { materializeBudgetIncomeAdjustments } from "@/server/helpers/budget-income-materializer";
import { eq } from "drizzle-orm";
import { SK_ACTIVE_SALARY_PROFILE_ID } from "@/lib/constants/settings-keys";

const mockGetExtraPaycheckMonthKeys = vi.fn();
vi.mock("@/lib/calculators/paycheck", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/calculators/paycheck")>();
  return {
    ...actual,
    getExtraPaycheckMonthKeys: (...args: unknown[]) =>
      mockGetExtraPaycheckMonthKeys(...args),
  };
});

describe("materializeBudgetIncomeAdjustments", () => {
  let ctx: TestDbContext;
  let salaryProfileId: number;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T00:00:00Z"));
    mockGetExtraPaycheckMonthKeys.mockReturnValue(["2026-06-01", "2026-07-01"]);

    ctx = await createTestDb();
    ctx.db
      .insert(ctx.schema.people)
      .values({
        id: 1,
        name: "Test",
        dateOfBirth: "1990-01-01",
        isPrimaryUser: true,
      })
      .run();
    ctx.db
      .insert(ctx.schema.jobs)
      .values({
        id: 1,
        personId: 1,
        employerName: "TestCo",
        startDate: "2020-01-01",
      })
      .run();
    const [salaryProfile] = ctx.db
      .insert(ctx.schema.salaryProfiles)
      .values({
        name: "Test Salary Profile",
        salaries: {
          "1": {
            salary: 100000,
            bonusPercent: 0,
            bonusMultiplier: 1,
            monthsInBonusYear: 12,
            bonusOverride: null,
            payPeriod: "biweekly",
            payWeek: "even",
            anchorPayDate: "2026-01-02",
            budgetPeriodsPerMonth: null,
            w4FilingStatus: "MFJ",
            w4Box2cChecked: false,
            additionalFedWithholding: 0,
            bonusMonth: null,
            bonusDayOfMonth: null,
            include401kInBonus: false,
            includeBonusInContributions: true,
            // Default: Budget mode (no rules). baseNetPayPerCheck is the
            // snapshot the materializer projects forward.
            extraPaycheckRouting: {
              rules: [],
              baseNetPayPerCheck: 1000,
              baseYear: 2026,
            },
          },
        },
      })
      .returning()
      .all();
    salaryProfileId = salaryProfile!.id;
    ctx.db
      .insert(ctx.schema.appSettings)
      .values({
        key: SK_ACTIVE_SALARY_PROFILE_ID,
        value: salaryProfile!.id,
      })
      .onConflictDoUpdate({
        target: ctx.schema.appSettings.key,
        set: { value: salaryProfile!.id },
      })
      .run();
  });

  afterEach(() => {
    ctx.cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  /** Patch job 1's extraPaycheckRouting in the active Salary Profile entry. */
  function updateRouting(routing: Record<string, unknown> | null): void {
    const [row] = ctx.db
      .select()
      .from(ctx.schema.salaryProfiles)
      .where(eq(ctx.schema.salaryProfiles.id, salaryProfileId))
      .all();
    const salaries = row!.salaries as Record<string, Record<string, unknown>>;
    ctx.db
      .update(ctx.schema.salaryProfiles)
      .set({
        salaries: {
          ...salaries,
          "1": { ...salaries["1"], extraPaycheckRouting: routing },
        },
      })
      .where(eq(ctx.schema.salaryProfiles.id, salaryProfileId))
      .run();
  }

  function rows() {
    return ctx.db
      .select()
      .from(ctx.schema.budgetIncomeAdjustments)
      .where(eq(ctx.schema.budgetIncomeAdjustments.source, "rule"))
      .all();
  }

  it("materializes one row per detected month for a Budget-mode job (no rules)", async () => {
    await materializeBudgetIncomeAdjustments(ctx.db as never);
    const r = rows();
    expect(r.map((x) => x.monthDate).sort()).toEqual([
      "2026-06-01",
      "2026-07-01",
    ]);
    expect(Number(r[0]!.amount)).toBe(1000);
  });

  it("materializes for a job paused into Budget mode via enabled:false, and cleans up when flipped back to Savings mode", async () => {
    // rules present but disabled → Budget mode.
    updateRouting({
      rules: [{ from: "2026-01", to: null, splits: [], netPaySnapshot: 1000 }],
      enabled: false,
      baseNetPayPerCheck: 1000,
      baseYear: 2026,
    });
    await materializeBudgetIncomeAdjustments(ctx.db as never);
    expect(rows().length).toBe(2);

    // Re-enable → Savings mode → budget rows must be cleared.
    updateRouting({
      rules: [{ from: "2026-01", to: null, splits: [], netPaySnapshot: 1000 }],
      enabled: true,
      baseNetPayPerCheck: 1000,
      baseYear: 2026,
    });
    await materializeBudgetIncomeAdjustments(ctx.db as never);
    expect(rows()).toEqual([]);
  });

  it("materializes nothing for a Savings-mode job (active rules)", async () => {
    updateRouting({
      rules: [{ from: "2026-01", to: null, splits: [], netPaySnapshot: 1000 }],
      baseNetPayPerCheck: 1000,
      baseYear: 2026,
    });
    await materializeBudgetIncomeAdjustments(ctx.db as never);
    expect(rows()).toEqual([]);
  });

  it("materializes nothing when the routing has no baseNetPayPerCheck snapshot", async () => {
    updateRouting({ rules: [] });
    await materializeBudgetIncomeAdjustments(ctx.db as never);
    expect(rows()).toEqual([]);
  });

  it("preserves a row dated before the current month across regeneration", async () => {
    ctx.db
      .insert(ctx.schema.budgetIncomeAdjustments)
      .values({
        jobId: 1,
        monthDate: "2026-01-01",
        amount: "1000",
        source: "rule",
      })
      .run();

    await materializeBudgetIncomeAdjustments(ctx.db as never);

    const jan = rows().find((r) => r.monthDate === "2026-01-01");
    expect(jan).toBeDefined();
  });

  it("applies yearly growth when projecting a future month's amount", async () => {
    mockGetExtraPaycheckMonthKeys.mockReturnValue(["2026-06-01", "2027-06-01"]);
    updateRouting({
      rules: [],
      baseNetPayPerCheck: 1000,
      baseYear: 2026,
      yearlyGrowth: { "2027": { type: "pct", value: 10 } },
    });

    await materializeBudgetIncomeAdjustments(ctx.db as never);

    const r = rows();
    expect(Number(r.find((x) => x.monthDate === "2026-06-01")!.amount)).toBe(
      1000,
    );
    expect(Number(r.find((x) => x.monthDate === "2027-06-01")!.amount)).toBe(
      1100,
    );
  });
});
