/**
 * Contribution Profile active-field coverage for tax-input job fields
 * (w4FilingStatus, w4Box2cChecked, additionalFedWithholding, payPeriod,
 * payWeek, anchorPayDate) and deductions (amountPerPeriod) — the gap this
 * plan closes: switching a Contribution Profile previously changed
 * contribution amounts but not tax/withholding or deduction amounts.
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
import { SK_ACTIVE_CONTRIB_PROFILE_ID } from "@/lib/constants/settings-keys";
import { eq } from "drizzle-orm";
import { applyContributionAccountEdit } from "@/server/helpers";

/** The migration seeds a default `active_contrib_profile_id` row — upsert
 *  rather than insert so setting it in a test doesn't hit the unique
 *  constraint. */
function setActiveContribProfile(
  db: Awaited<ReturnType<typeof createTestCaller>>["db"],
  profileId: number,
) {
  db.insert(sqliteSchema.appSettings)
    .values({ key: SK_ACTIVE_CONTRIB_PROFILE_ID, value: String(profileId) })
    .onConflictDoUpdate({
      target: sqliteSchema.appSettings.key,
      set: { value: String(profileId) },
    })
    .run();
}

describe("paycheck.computeSummary — tax-input active fields", () => {
  it("a profile's w4FilingStatus/additionalFedWithholding active fields change computed federal withholding", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "TaxInputPerson");
      const jobId = seedJob(db, personId, {
        annualSalary: "150000",
        w4FilingStatus: "MFJ",
        w4Box2cChecked: false,
      });

      const withoutProfile = await caller.paycheck.computeSummary();
      const baseline = withoutProfile.people.find(
        (p) => p.person.id === personId,
      )!;

      const profileId = seedContributionProfile(db, {
        name: "Tax Input Profile",
        contributionActiveFields: {
          contributionAccounts: {},
          jobs: {
            [String(jobId)]: {
              w4FilingStatus: "Single",
              additionalFedWithholding: "100",
            },
          },
        },
      });

      const withProfile = await caller.paycheck.computeSummary({
        contributionProfileId: profileId,
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

  it("a profile-set payPeriod changes the live pay stub's periodsPerYear", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "PayPeriodPerson");
      const jobId = seedJob(db, personId, {
        payPeriod: "biweekly",
        payWeek: "even",
        anchorPayDate: "2026-01-02",
      });

      const profileId = seedContributionProfile(db, {
        name: "Weekly Profile",
        contributionActiveFields: {
          contributionAccounts: {},
          jobs: {
            [String(jobId)]: {
              payPeriod: "weekly",
              payWeek: "na",
              anchorPayDate: "2026-01-02",
            },
          },
        },
      });

      const result = await caller.paycheck.computeSummary({
        contributionProfileId: profileId,
      });
      const person = result.people.find((p) => p.person.id === personId)!;
      expect(person.paycheck!.periodsPerYear).toBe(52);
    } finally {
      cleanup();
    }
  });

  it("falls back to the job's live defaults when the profile has no active fields set for it", async () => {
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
        contributionActiveFields: { contributionAccounts: {}, jobs: {} },
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
  function seedDeduction(
    db: Awaited<ReturnType<typeof createTestCaller>>["db"],
    jobId: number,
    amountPerPeriod: string,
  ): number {
    return db
      .insert(sqliteSchema.paycheckDeductions)
      .values({
        jobId,
        deductionName: "Dental",
        amountPerPeriod,
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
      const deductionId = seedDeduction(db, jobId, "20");

      const profileId = seedContributionProfile(db, {
        name: "Deduction Profile",
        contributionActiveFields: {
          contributionAccounts: {},
          jobs: {},
          deductions: { [String(deductionId)]: { amountPerPeriod: "75" } },
        },
      });

      const withoutProfile = await caller.paycheck.computeSummary();
      const withProfile = await caller.paycheck.computeSummary({
        contributionProfileId: profileId,
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

  it("an explicit zero active-field value zeroes the deduction, not falls back to live", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "ZeroDeductionPerson");
      const jobId = seedJob(db, personId);
      const deductionId = seedDeduction(db, jobId, "40");

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
      const deductionId = seedDeduction(db, jobId, "20");

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

describe("computeJobNetPayPerCheck / extraPaycheckRouting — profile resolution + payPeriod mismatch guard", () => {
  it("baseNetPayPerCheck reflects the globally-active profile's tax-input/deduction active fields", async () => {
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
      });
      const goalId = seedSavingsGoal(db);

      const rules = [
        { from: "2026-01", to: null, splits: [{ goalId, pct: 100 }] },
      ];

      // Job A: saved with no globally-active profile — live default.
      await caller.savings.extraPaycheckRouting.save({
        jobId: jobIdA,
        rules,
      });

      // Job B: saved under a profile adding $500/check extra withholding.
      const profileId = seedContributionProfile(db, {
        name: "Routing Profile",
        contributionActiveFields: {
          contributionAccounts: {},
          jobs: {
            [String(jobIdB)]: { additionalFedWithholding: "500" },
          },
        },
      });
      setActiveContribProfile(db, profileId);
      await caller.savings.extraPaycheckRouting.save({
        jobId: jobIdB,
        rules,
      });

      const rows = await db
        .select({
          id: sqliteSchema.jobs.id,
          extraPaycheckRouting: sqliteSchema.jobs.extraPaycheckRouting,
        })
        .from(sqliteSchema.jobs)
        .where(eq(sqliteSchema.jobs.id, jobIdA));
      const rowsB = await db
        .select({
          id: sqliteSchema.jobs.id,
          extraPaycheckRouting: sqliteSchema.jobs.extraPaycheckRouting,
        })
        .from(sqliteSchema.jobs)
        .where(eq(sqliteSchema.jobs.id, jobIdB));

      const baseNetA = rows[0]!.extraPaycheckRouting!.baseNetPayPerCheck;
      const baseNetB = rowsB[0]!.extraPaycheckRouting!.baseNetPayPerCheck;
      // $500 extra per-check withholding under Job B's profile reduces its
      // net pay by (approximately) $500 relative to the unaffected Job A.
      expect(baseNetA - baseNetB).toBeCloseTo(500, 0);
    } finally {
      cleanup();
    }
  });

  it("snapshots the globally-active profile's payPeriod/anchorPayDate at save time, even when they differ from the job's live values (Stage A: no mismatch guard, freeze instead)", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "MismatchPerson");
      const jobId = seedJob(db, personId, {
        payPeriod: "biweekly",
        payWeek: "even",
        anchorPayDate: "2026-01-02",
      });
      const goalId = seedSavingsGoal(db);

      const profileId = seedContributionProfile(db, {
        name: "Mismatched Schedule Profile",
        contributionActiveFields: {
          contributionAccounts: {},
          jobs: {
            [String(jobId)]: {
              payPeriod: "weekly",
              payWeek: "na",
              anchorPayDate: "2026-01-09",
            },
          },
        },
      });
      setActiveContribProfile(db, profileId);

      // No mismatch guard any more — the save succeeds and freezes the
      // profile's own resolved schedule into the snapshot, rather than
      // rejecting because it differs from the job's live column.
      const saved = await caller.savings.extraPaycheckRouting.save({
        jobId,
        rules: [{ from: "2026-01", to: null, splits: [{ goalId, pct: 100 }] }],
      });
      expect(saved).toEqual({ ok: true });

      const [row] = await db
        .select({
          extraPaycheckRouting: sqliteSchema.jobs.extraPaycheckRouting,
        })
        .from(sqliteSchema.jobs)
        .where(eq(sqliteSchema.jobs.id, jobId));
      expect(row?.extraPaycheckRouting?.payPeriod).toBe("weekly");
      expect(row?.extraPaycheckRouting?.anchorPayDate).toBe("2026-01-09");
    } finally {
      cleanup();
    }
  });

  it("succeeds when the globally-active profile's payPeriod matches the job's real payPeriod", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "MatchingSchedulePerson");
      const jobId = seedJob(db, personId, {
        payPeriod: "biweekly",
        payWeek: "even",
        anchorPayDate: "2026-01-02",
      });

      const profileId = seedContributionProfile(db, {
        name: "Matching Schedule Profile",
        contributionActiveFields: {
          contributionAccounts: {},
          jobs: {
            [String(jobId)]: {
              payPeriod: "biweekly",
              payWeek: "even",
              anchorPayDate: "2026-01-02",
            },
          },
        },
      });
      setActiveContribProfile(db, profileId);

      const saved = await caller.savings.extraPaycheckRouting.save({
        jobId,
        rules: [],
      });
      expect(saved).toEqual({ ok: true });

      const [row] = await db
        .select({
          extraPaycheckRouting: sqliteSchema.jobs.extraPaycheckRouting,
        })
        .from(sqliteSchema.jobs)
        .where(eq(sqliteSchema.jobs.id, jobId));
      // Empty rules → routing is cleared to null, not written with a
      // baseNetPayPerCheck — confirms the guard didn't block a legitimate
      // matching-schedule save (an empty-rules save short-circuits to
      // null before persisting a snapshot).
      expect(row?.extraPaycheckRouting ?? null).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe("applyContributionAccountEdit — inverse-path uses the edit's own profile, not the globally-active one", () => {
  it("resolves periodsPerYear against the profile passed in, even when it is not globally active", async () => {
    const { db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "BudgetLinkPerson");
      // The job's real, raw schedule is biweekly (26 periods/yr) — and
      // stays the globally-active setting throughout this test (never
      // set), so a bug reverting to "the globally-active profile" would
      // silently fall back to biweekly for BOTH edits below.
      const jobId = seedJob(db, personId, { payPeriod: "biweekly" });

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

      const biweeklyProfileId = seedContributionProfile(db, {
        name: "Biweekly Schedule",
        contributionActiveFields: {
          contributionAccounts: {
            [String(accountId)]: { contributionMethod: "fixed_per_period" },
          },
          jobs: {},
        },
      });
      const weeklyProfileId = seedContributionProfile(db, {
        name: "Weekly Schedule",
        contributionActiveFields: {
          contributionAccounts: {
            [String(accountId)]: { contributionMethod: "fixed_per_period" },
          },
          jobs: {
            [String(jobId)]: {
              payPeriod: "weekly",
              payWeek: "na",
              anchorPayDate: "2026-01-02",
            },
          },
        },
      });

      const monthlyAmount = 1000;
      await applyContributionAccountEdit(
        db,
        accountId,
        monthlyAmount,
        biweeklyProfileId,
      );
      await applyContributionAccountEdit(
        db,
        accountId,
        monthlyAmount,
        weeklyProfileId,
      );

      const [biweeklyProfile] = await db
        .select({
          contributionActiveFields:
            sqliteSchema.contributionProfiles.contributionActiveFields,
        })
        .from(sqliteSchema.contributionProfiles)
        .where(eq(sqliteSchema.contributionProfiles.id, biweeklyProfileId));
      const [weeklyProfile] = await db
        .select({
          contributionActiveFields:
            sqliteSchema.contributionProfiles.contributionActiveFields,
        })
        .from(sqliteSchema.contributionProfiles)
        .where(eq(sqliteSchema.contributionProfiles.id, weeklyProfileId));

      const biweeklyValue = Number(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSONB active-field leaf shape
        (biweeklyProfile!.contributionActiveFields as any).contributionAccounts[
          String(accountId)
        ].contributionValue,
      );
      const weeklyValue = Number(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSONB active-field leaf shape
        (weeklyProfile!.contributionActiveFields as any).contributionAccounts[
          String(accountId)
        ].contributionValue,
      );

      // (1000 * 12) / 26 vs (1000 * 12) / 52 — each profile's own
      // periodsPerYear, not the raw job's biweekly value for both.
      expect(biweeklyValue).toBeCloseTo((monthlyAmount * 12) / 26, 1);
      expect(weeklyValue).toBeCloseTo((monthlyAmount * 12) / 52, 1);
      expect(biweeklyValue).not.toBeCloseTo(weeklyValue, 1);
    } finally {
      cleanup();
    }
  });
});
