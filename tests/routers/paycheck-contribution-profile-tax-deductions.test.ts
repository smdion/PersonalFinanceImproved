/**
 * Salary Profile coverage for tax-input/schedule fields (w4FilingStatus,
 * w4Box2cChecked, additionalFedWithholding, payPeriod, payWeek,
 * anchorPayDate) and Contribution Profile coverage for deductions
 * (amountPerPeriod). Originally written against the superseded Stage-A
 * design (Contribution Profile owned all of these via a `jobs` active-fields
 * bucket) — updated for Stage B, where tax-input/schedule fields moved to
 * the Salary Profile entry and the Contribution Profile `jobs` bucket is
 * deleted wholesale. Deductions still resolve via Contribution Profile.
 */
import "./setup-mocks";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

import {
  createTestCaller,
  adminSession,
  seedPerson,
  seedJob,
  seedContributionProfile,
  seedSavingsGoal,
} from "./setup";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import { eq } from "drizzle-orm";
import { applyContributionAccountEdit } from "@/server/helpers";
import { SK_ACTIVE_SALARY_PROFILE_ID } from "@/lib/constants/settings-keys";

/** Read a job's extraPaycheckRouting straight from its entry in the
 *  globally-active Salary Profile — same place writeJobExtraPaycheckRouting
 *  (savings.ts) writes it now that it no longer lives on `jobs`. */
function getRouting(
  db: Awaited<ReturnType<typeof createTestCaller>>["db"],
  jobId: number,
) {
  const activeSettingRow = db
    .select()
    .from(sqliteSchema.appSettings)
    .where(eq(sqliteSchema.appSettings.key, SK_ACTIVE_SALARY_PROFILE_ID))
    .get();
  const activeSalaryProfileId = Number(activeSettingRow!.value);
  const activeSalaryProfile = db
    .select()
    .from(sqliteSchema.salaryProfiles)
    .where(eq(sqliteSchema.salaryProfiles.id, activeSalaryProfileId))
    .get()!;
  const salaries = activeSalaryProfile.salaries as Record<
    string,
    { extraPaycheckRouting?: Record<string, unknown> | null }
  >;
  return salaries[String(jobId)]?.extraPaycheckRouting ?? null;
}

describe("paycheck.computeSummary — tax-input active fields", () => {
  it("a different Salary Profile's w4FilingStatus/additionalFedWithholding change computed federal withholding", async () => {
    // w4FilingStatus/additionalFedWithholding are Salary-Profile-owned now
    // — the Contribution Profile `jobs` bucket that used to carry them is
    // deleted wholesale. Compare the default active Salary Profile against
    // an explicitly-passed alternate one for the same job.
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "TaxInputPerson");
      const jobId = seedJob(db, personId, {
        annualSalary: "150000",
        w4FilingStatus: "MFJ",
        w4Box2cChecked: false,
      });

      const baselineResult = await caller.paycheck.computeSummary();
      const baseline = baselineResult.people.find(
        (p) => p.person.id === personId,
      )!;

      const altSalaryProfileId = db
        .insert(sqliteSchema.salaryProfiles)
        .values({
          name: "Single Filer, Extra Withholding",
          salaries: {
            [String(jobId)]: {
              salary: 150000,
              bonusPercent: 0,
              bonusMultiplier: 1,
              monthsInBonusYear: 12,
              bonusOverride: null,
              payPeriod: "biweekly",
              payWeek: "na",
              anchorPayDate: null,
              budgetPeriodsPerMonth: null,
              w4FilingStatus: "Single",
              w4Box2cChecked: false,
              additionalFedWithholding: 100,
              bonusMonth: null,
              bonusDayOfMonth: null,
              include401kInBonus: false,
              includeBonusInContributions: true,
            },
          },
        })
        .returning({ id: sqliteSchema.salaryProfiles.id })
        .get().id;

      const withProfile = await caller.paycheck.computeSummary({
        salaryProfileId: altSalaryProfileId,
      });
      const withProfilePerson = withProfile.people.find(
        (p) => p.person.id === personId,
      )!;

      expect(withProfilePerson.paycheck!.federalWithholding).not.toBeCloseTo(
        baseline.paycheck!.federalWithholding,
        2,
      );
      // additionalFedWithholding of 100 is added, per check, on top of
      // whatever the Single-filing-status bracket produces — so the
      // Single-filing withholding + 100 should equal the total.
      expect(withProfilePerson.paycheck!.federalWithholding).toBeGreaterThan(
        baseline.paycheck!.federalWithholding,
      );
    } finally {
      cleanup();
    }
  });

  it("a different Salary Profile's payPeriod changes the live pay stub's periodsPerYear", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "PayPeriodPerson");
      const jobId = seedJob(db, personId, {
        payPeriod: "biweekly",
        payWeek: "even",
        anchorPayDate: "2026-01-02",
      });

      const weeklySalaryProfileId = db
        .insert(sqliteSchema.salaryProfiles)
        .values({
          name: "Weekly Schedule",
          salaries: {
            [String(jobId)]: {
              salary: 100000,
              bonusPercent: 0,
              bonusMultiplier: 1,
              monthsInBonusYear: 12,
              bonusOverride: null,
              payPeriod: "weekly",
              payWeek: "na",
              anchorPayDate: "2026-01-02",
              budgetPeriodsPerMonth: null,
              w4FilingStatus: "MFJ",
              w4Box2cChecked: false,
              additionalFedWithholding: 0,
              bonusMonth: null,
              bonusDayOfMonth: null,
              include401kInBonus: false,
              includeBonusInContributions: true,
            },
          },
        })
        .returning({ id: sqliteSchema.salaryProfiles.id })
        .get().id;

      const result = await caller.paycheck.computeSummary({
        salaryProfileId: weeklySalaryProfileId,
      });
      const person = result.people.find((p) => p.person.id === personId)!;
      expect(person.paycheck!.periodsPerYear).toBe(52);
    } finally {
      cleanup();
    }
  });

  it("falls back to the default active Salary Profile when no explicit one is passed", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "NoActiveFieldsPerson");
      seedJob(db, personId, { w4FilingStatus: "HOH" });

      const withoutProfile = await caller.paycheck.computeSummary();
      const baseline = withoutProfile.people.find(
        (p) => p.person.id === personId,
      )!;

      const profileId = seedContributionProfile(db, {
        name: "Empty Profile",
        contributionActiveFields: { contributionAccounts: {} },
      });

      const withEmptyProfile = await caller.paycheck.computeSummary({
        contributionProfileId: profileId,
      });
      const withEmptyProfilePerson = withEmptyProfile.people.find(
        (p) => p.person.id === personId,
      )!;

      expect(withEmptyProfilePerson.paycheck!.federalWithholding).toBeCloseTo(
        baseline.paycheck!.federalWithholding,
        2,
      );
    } finally {
      cleanup();
    }
  });
});

describe("paycheck.computeSummary — deduction active fields", () => {
  // amountPerPeriod no longer lives on the paycheck_deductions row
  // (Stage B) — it seeds only the structural fields; any dollar amount a
  // test needs comes from a Contribution Profile's deductions active field.
  function seedDeduction(
    db: Awaited<ReturnType<typeof createTestCaller>>["db"],
    jobId: number,
  ): number {
    return db
      .insert(sqliteSchema.paycheckDeductions)
      .values({
        jobId,
        deductionName: "Dental",
        isPretax: false,
        ficaExempt: false,
      })
      .returning({ id: sqliteSchema.paycheckDeductions.id })
      .get().id;
  }

  it("a profile's amountPerPeriod active field changes computed net pay", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "DeductionPerson");
      const jobId = seedJob(db, personId);
      const deductionId = seedDeduction(db, jobId);

      // No row-level "live" amount exists any more — both the $20 baseline
      // and the $75 override are Contribution Profile deductions
      // active-field entries, compared against each other rather than
      // against a no-profile call.
      const baselineProfileId = seedContributionProfile(db, {
        name: "Deduction Baseline Profile",
        contributionActiveFields: {
          contributionAccounts: {},
          jobs: {},
          deductions: { [String(deductionId)]: { amountPerPeriod: "20" } },
        },
      });
      const overrideProfileId = seedContributionProfile(db, {
        name: "Deduction Profile",
        contributionActiveFields: {
          contributionAccounts: {},
          jobs: {},
          deductions: { [String(deductionId)]: { amountPerPeriod: "75" } },
        },
      });

      const withoutProfile = await caller.paycheck.computeSummary({
        contributionProfileId: baselineProfileId,
      });
      const withProfile = await caller.paycheck.computeSummary({
        contributionProfileId: overrideProfileId,
      });

      const baseline = withoutProfile.people.find(
        (p) => p.person.id === personId,
      )!;
      const overridden = withProfile.people.find(
        (p) => p.person.id === personId,
      )!;

      expect(overridden.paycheck!.netPay).not.toBeCloseTo(
        baseline.paycheck!.netPay,
        2,
      );
      // A higher post-tax deduction reduces net pay by roughly the delta
      // (55 = 75 - 20), post-tax so no tax-shield offset.
      expect(
        baseline.paycheck!.netPay - overridden.paycheck!.netPay,
      ).toBeCloseTo(55, 1);
    } finally {
      cleanup();
    }
  });

  it("an explicit zero active-field value zeroes the deduction", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "ZeroDeductionPerson");
      const jobId = seedJob(db, personId);
      const deductionId = seedDeduction(db, jobId);

      const profileId = seedContributionProfile(db, {
        name: "Zero Deduction Profile",
        contributionActiveFields: {
          contributionAccounts: {},
          jobs: {},
          deductions: { [String(deductionId)]: { amountPerPeriod: "0" } },
        },
      });

      const result = await caller.paycheck.computeSummary({
        contributionProfileId: profileId,
      });
      const person = result.people.find((p) => p.person.id === personId)!;
      const dentalLine = person.paycheck!.postTaxDeductions.find(
        (d) => d.name === "Dental",
      );
      expect(dentalLine?.amount).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("the What-If sandbox edit layers on top of a profile's active-field value", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "SandboxDeductionPerson");
      const jobId = seedJob(db, personId);
      const deductionId = seedDeduction(db, jobId);

      const profileId = seedContributionProfile(db, {
        name: "Sandbox Layer Profile",
        contributionActiveFields: {
          contributionAccounts: {},
          jobs: {},
          deductions: { [String(deductionId)]: { amountPerPeriod: "75" } },
        },
      });

      const result = await caller.paycheck.computeSummary({
        contributionProfileId: profileId,
        sandboxDeductionEdits: [{ id: deductionId, amountPerPeriod: 200 }],
      });
      const person = result.people.find((p) => p.person.id === personId)!;
      const dentalLine = person.paycheck!.postTaxDeductions.find(
        (d) => d.name === "Dental",
      );
      // Sandbox (200) wins over the profile's active field (75), which in
      // turn already won over the live default (20).
      expect(dentalLine?.amount).toBe(200);
    } finally {
      cleanup();
    }
  });
});

describe("computeJobNetPayPerCheck / extraPaycheckRouting — Salary Profile resolution", () => {
  it("baseNetPayPerCheck reflects the globally-active Salary Profile's tax-input for that job", async () => {
    // additionalFedWithholding is Salary-Profile-owned now — the
    // Contribution Profile `jobs` bucket that used to carry it is deleted
    // wholesale. seedJob's overrides write straight into the shared
    // default active Salary Profile (see setup.ts), so job B's own entry
    // can differ from job A's without needing a second profile.
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personIdA = await seedPerson(db, "RoutingPersonA");
      const jobIdA = seedJob(db, personIdA, {
        payPeriod: "biweekly",
        payWeek: "even",
        anchorPayDate: "2026-01-02",
      });
      const personIdB = await seedPerson(db, "RoutingPersonB");
      const jobIdB = seedJob(db, personIdB, {
        payPeriod: "biweekly",
        payWeek: "even",
        anchorPayDate: "2026-01-02",
        additionalFedWithholding: "500",
      });
      const goalId = seedSavingsGoal(db);

      const rules = [
        { from: "2026-01", to: null, splits: [{ goalId, pct: 100 }] },
      ];

      // Job A: no extra withholding.
      await caller.savings.extraPaycheckRouting.save({
        jobId: jobIdA,
        rules,
      });

      // Job B: its own Salary Profile entry adds $500/check extra withholding.
      await caller.savings.extraPaycheckRouting.save({
        jobId: jobIdB,
        rules,
      });

      const routingA = getRouting(db, jobIdA) as {
        baseNetPayPerCheck: number;
      };
      const routingB = getRouting(db, jobIdB) as {
        baseNetPayPerCheck: number;
      };

      const baseNetA = routingA.baseNetPayPerCheck;
      const baseNetB = routingB.baseNetPayPerCheck;
      // $500 extra per-check withholding under Job B's profile reduces its
      // net pay by (approximately) $500 relative to the unaffected Job A.
      expect(baseNetA - baseNetB).toBeCloseTo(500, 0);
    } finally {
      cleanup();
    }
  });

  it("snapshots the job's Salary Profile payPeriod/anchorPayDate at save time", async () => {
    // There is only one source for payPeriod/anchorPayDate now (the
    // Salary Profile entry) — the old "Contribution Profile sets a
    // mismatched schedule vs. the job's live column" scenario is no
    // longer representable, since both used to be independently settable
    // and now aren't.
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "SnapshotPerson");
      const jobId = seedJob(db, personId, {
        payPeriod: "weekly",
        payWeek: "na",
        anchorPayDate: "2026-01-09",
      });
      const goalId = seedSavingsGoal(db);

      const saved = await caller.savings.extraPaycheckRouting.save({
        jobId,
        rules: [{ from: "2026-01", to: null, splits: [{ goalId, pct: 100 }] }],
      });
      expect(saved).toEqual({ ok: true });

      const routing = getRouting(db, jobId) as {
        payPeriod?: string;
        anchorPayDate?: string | null;
      };
      expect(routing?.payPeriod).toBe("weekly");
      expect(routing?.anchorPayDate).toBe("2026-01-09");
    } finally {
      cleanup();
    }
  });

  it("succeeds for the job's ordinary biweekly Salary Profile schedule", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "MatchingSchedulePerson");
      const jobId = seedJob(db, personId, {
        payPeriod: "biweekly",
        payWeek: "even",
        anchorPayDate: "2026-01-02",
      });

      const saved = await caller.savings.extraPaycheckRouting.save({
        jobId,
        rules: [],
      });
      expect(saved).toEqual({ ok: true });

      // Empty rules → routing is cleared to null, not written with a
      // baseNetPayPerCheck — confirms the guard didn't block a legitimate
      // matching-schedule save (an empty-rules save short-circuits to
      // null before persisting a snapshot).
      expect(getRouting(db, jobId)).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe("applyContributionAccountEdit — periodsPerYear resolves from the globally-active Salary Profile", () => {
  it("resolves the same periodsPerYear regardless of which Contribution Profile the edit targets", async () => {
    // Pay schedule is Salary-Profile-owned now — a Contribution Profile
    // can no longer change periodsPerYear at all (the `jobs` bucket that
    // used to let it is deleted). Two different Contribution Profiles
    // editing the same jobless account must resolve the SAME
    // periodsPerYear, from the one globally-active Salary Profile.
    const { db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "BudgetLinkPerson");
      seedJob(db, personId, { payPeriod: "biweekly" });

      // Budget-linked accounts must have jobId === null. Inserted directly
      // (not via the generic seedContributionAccount helper, which targets
      // stale column names) with the real contribution_accounts columns.
      const accountId = db
        .insert(sqliteSchema.contributionAccounts)
        .values({
          jobId: null,
          personId,
          accountType: "brokerage",
          parentCategory: "Brokerage",
          taxTreatment: "after_tax",
          employerMatchType: "none",
          isActive: true,
        })
        .returning({ id: sqliteSchema.contributionAccounts.id })
        .get().id;

      const profileAId = seedContributionProfile(db, {
        name: "Profile A",
        contributionActiveFields: {
          contributionAccounts: {
            [String(accountId)]: { contributionMethod: "fixed_per_period" },
          },
        },
      });
      const profileBId = seedContributionProfile(db, {
        name: "Profile B",
        contributionActiveFields: {
          contributionAccounts: {
            [String(accountId)]: { contributionMethod: "fixed_per_period" },
          },
        },
      });

      const monthlyAmount = 1000;
      await applyContributionAccountEdit(
        db,
        accountId,
        monthlyAmount,
        profileAId,
      );
      const valueA = await readContributionValue(db, profileAId, accountId);

      await applyContributionAccountEdit(
        db,
        accountId,
        monthlyAmount,
        profileBId,
      );
      const valueB = await readContributionValue(db, profileBId, accountId);

      // (1000 * 12) / 26 — the job's biweekly Salary Profile schedule, for
      // both profiles.
      expect(valueA).toBeCloseTo((monthlyAmount * 12) / 26, 1);
      expect(valueB).toBeCloseTo((monthlyAmount * 12) / 26, 1);
    } finally {
      cleanup();
    }
  });
});

async function readContributionValue(
  db: Awaited<ReturnType<typeof createTestCaller>>["db"],
  profileId: number,
  accountId: number,
): Promise<number> {
  const [profile] = await db
    .select({
      contributionActiveFields:
        sqliteSchema.contributionProfiles.contributionActiveFields,
    })
    .from(sqliteSchema.contributionProfiles)
    .where(eq(sqliteSchema.contributionProfiles.id, profileId));
  return Number(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSONB active-field leaf shape
    (profile!.contributionActiveFields as any).contributionAccounts[
      String(accountId)
    ].contributionValue,
  );
}
