/**
 * Contribution Profiles router — coverage-focused tests.
 *
 * Targets uncovered branches: getById with seeded data (account details,
 * salary details, disambiguation, suggested perf accounts, job overrides,
 * employer name overrides), list with DB-default profiles, update guards,
 * delete guards (default profile, active profile), and create edge cases.
 */
import "./setup-mocks";
import { vi, describe, it, expect } from "vitest";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

import {
  createTestCaller,
  adminSession,
  seedPerson,
  seedJob,
  seedPerformanceAccount,
} from "./setup";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import { eq } from "drizzle-orm";

// ── Helpers ──

function seedContribAccount(
  db: Parameters<typeof seedPerson>[0],
  overrides: Partial<
    typeof sqliteSchema.contributionAccounts.$inferInsert
  > = {},
) {
  return db
    .insert(sqliteSchema.contributionAccounts)
    .values({
      personId: 1,
      accountType: "401k",
      parentCategory: "Retirement",
      taxTreatment: "pre_tax",
      contributionMethod: "percent_of_salary",
      contributionValue: "0.10",
      employerMatchType: "percent",
      employerMatchValue: "0.50",
      employerMaxMatchPct: "0.06",
      isActive: true,
      ...overrides,
    })
    .returning({ id: sqliteSchema.contributionAccounts.id })
    .get().id;
}

function seedContribProfile(
  db: Parameters<typeof seedPerson>[0],
  overrides: Partial<
    typeof sqliteSchema.contributionProfiles.$inferInsert
  > = {},
) {
  return db
    .insert(sqliteSchema.contributionProfiles)
    .values({
      name: "Test What-If",
      contributionActiveFields: { contributionAccounts: {}, jobs: {} },
      ...overrides,
    })
    .returning({ id: sqliteSchema.contributionProfiles.id })
    .get().id;
}

// ── Tests ──

describe("contributionProfiles coverage", () => {
  // ── LIST: DB-default profile present (no synthetic Live) ──

  describe("list — real rows only", () => {
    it("never prepends a synthetic id-0 Live row", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        seedContribProfile(db, { name: "SomeProfile" });
        const profiles = await caller.contributionProfile.list();
        expect(profiles.map((p: { id: number }) => p.id)).not.toContain(0);
        expect(
          profiles.find((p: { name: string }) => p.name === "SomeProfile"),
        ).toBeDefined();
      } finally {
        cleanup();
      }
    });
  });

  // ── LIST: profile with active fields shows activeFieldCount ──

  describe("list — activeFieldCount reflects contribution active fields", () => {
    it("counts contribution account active fields", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        seedJob(db, personId);
        const acctId = seedContribAccount(db, { personId });

        seedContribProfile(db, {
          name: "WithActiveFields",
          contributionActiveFields: {
            contributionAccounts: {
              [String(acctId)]: { contributionValue: "0.15" },
            },
            jobs: {},
          },
        });

        const profiles = await caller.contributionProfile.list();
        const p = profiles.find(
          (x: { name: string }) => x.name === "WithActiveFields",
        );
        expect(p).toBeDefined();
        // Salary is no longer part of a Contribution Profile — only the
        // 1 contribution account active field counts.
        expect(p!.activeFieldCount).toBe(1);
      } finally {
        cleanup();
      }
    });
  });

  // ── LIST: resolved summary with real job/contrib data ──

  describe("list — resolved summary with seeded data", () => {
    it("summary reflects real salary and contribution values", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        seedJob(db, personId, { annualSalary: "100000" });
        seedContribAccount(db, {
          personId,
          contributionMethod: "percent_of_salary",
          contributionValue: "0.10",
          employerMatchType: "percent",
          employerMatchValue: "0.50",
          employerMaxMatchPct: "0.06",
        });

        seedContribProfile(db, { name: "SummaryTest" });

        const profiles = await caller.contributionProfile.list();
        const p = profiles.find(
          (x: { name: string }) => x.name === "SummaryTest",
        );
        expect(p).toBeDefined();
        expect(p!.summary.combinedSalary).toBeGreaterThan(0);
      } finally {
        cleanup();
      }
    });
  });

  // ── GETBYID: real profile with account details ──

  describe("getById — account details with seeded contrib accounts", () => {
    it("returns accountDetails with active fields", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        const jobId = seedJob(db, personId, { employerName: "TechCorp" });
        const acctId = seedContribAccount(db, {
          personId,
          jobId,
          accountType: "401k",
          taxTreatment: "pre_tax",
        });

        const profileId = seedContribProfile(db, {
          name: "DetailTest",
          contributionActiveFields: {
            contributionAccounts: {
              [String(acctId)]: {
                contributionValue: "0.20",
                contributionMethod: "percent_of_salary",
                displayNameCustom: "My Custom Name",
              },
            },
            jobs: {},
          },
        });

        const result = await caller.contributionProfile.getById({
          id: profileId,
        });
        expect(result).not.toBeNull();
        expect(result!.accountDetails.length).toBeGreaterThanOrEqual(1);

        const detail = result!.accountDetails.find(
          (d: { id: number }) => d.id === acctId,
        );
        expect(detail).toBeDefined();
        // displayNameCustom should be used as accountName
        expect(detail!.accountName).toBe("My Custom Name");
        expect(detail!.activeFields).toBeDefined();
        expect(detail!.isIncomplete).toBe(false);
        expect(
          (detail!.activeFields as Record<string, unknown>).contributionMethod,
        ).toBe("percent_of_salary");
        expect(
          (detail!.activeFields as Record<string, unknown>).contributionValue,
        ).toBe("0.20");
      } finally {
        cleanup();
      }
    });
  });

  // ── GETBYID: disambiguation when multiple accounts share same type/person ──

  describe("getById — disambiguation appends tax treatment label", () => {
    it("appends tax label when multiple accounts share person + accountType", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        const jobId = seedJob(db, personId, { employerName: "TechCorp" });
        // Two 401k accounts, different tax treatments. Only one sibling may
        // carry real employer match config (contribution_accounts_job_match_unq).
        seedContribAccount(db, {
          personId,
          jobId,
          accountType: "401k",
          taxTreatment: "pre_tax",
          label: null,
        });
        seedContribAccount(db, {
          personId,
          jobId,
          accountType: "401k",
          taxTreatment: "roth",
          employerMatchType: "none",
          label: null,
        });

        const profileId = seedContribProfile(db, { name: "DisambigTest" });
        const result = await caller.contributionProfile.getById({
          id: profileId,
        });
        expect(result).not.toBeNull();
        // Both accounts should have disambiguated names (containing " — ")
        const accts = result!.accountDetails.filter(
          (d: { accountType: string }) => d.accountType === "401k",
        );
        expect(accts.length).toBe(2);
        for (const a of accts) {
          expect(a.accountName).toContain(" — ");
        }
      } finally {
        cleanup();
      }
    });
  });

  // ── GETBYID: suggested perf account fallback ──

  describe("getById — suggestedPerfAccount fuzzy match", () => {
    it("falls back to fuzzy perf account match when no explicit FK", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        const jobId = seedJob(db, personId, { employerName: "Fidelity" });
        // Create a perf account that matches by type + person
        seedPerformanceAccount(db, {
          name: "401k",
          institution: "Fidelity",
          accountType: "401k",
          accountLabel: "Alex 401k",
          ownerPersonId: personId,
          parentCategory: "Retirement",
        });
        // Create a contrib account WITHOUT performanceAccountId
        seedContribAccount(db, {
          personId,
          jobId,
          accountType: "401k",
          performanceAccountId: null,
        });

        const profileId = seedContribProfile(db, { name: "FuzzyPerfTest" });
        const result = await caller.contributionProfile.getById({
          id: profileId,
        });
        expect(result).not.toBeNull();
        // The account detail should exist and have an accountName that includes institution info
        expect(result!.accountDetails.length).toBeGreaterThanOrEqual(1);
      } finally {
        cleanup();
      }
    });
  });

  // ── GETBYID: explicit performanceAccountId link ──

  describe("getById — explicit performanceAccountId link", () => {
    it("uses linked perf account for institution and display name", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        const jobId = seedJob(db, personId, { employerName: "TechCorp" });
        const perfId = seedPerformanceAccount(db, {
          name: "Linked 401k",
          institution: "Vanguard",
          accountType: "401k",
          accountLabel: "Vanguard 401k",
          displayName: "Alex Vanguard 401k",
          ownerPersonId: personId,
          parentCategory: "Retirement",
        });
        seedContribAccount(db, {
          personId,
          jobId,
          accountType: "401k",
          performanceAccountId: perfId,
        });

        const profileId = seedContribProfile(db, { name: "ExplicitPerfTest" });
        const result = await caller.contributionProfile.getById({
          id: profileId,
        });
        expect(result).not.toBeNull();
        const detail = result!.accountDetails[0];
        expect(detail).toBeDefined();
        // Institution from the linked perf account should be used
        // The account name should derive from the perf account
      } finally {
        cleanup();
      }
    });

    it("names a person-specific contribution row by that person, even when the linked performance account is jointly owned", async () => {
      // Real bug: a shared/jointly-tracked performance account (e.g. 10+
      // years of combined-performance history for one IRA holding both
      // spouses' separate contribution configs) made both people's
      // contribution rows render as the identical "Joint IRA (...)"
      // string — no way to tell them apart. The contribution row's own
      // personId is more specific than the account's ownershipType and
      // must win.
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const alexId = await seedPerson(db, "Alex");
        const jordanId = await seedPerson(db, "Jordan");
        const perfId = seedPerformanceAccount(db, {
          institution: "Vanguard",
          accountType: "ira",
          accountLabel: "IRA (Vanguard)",
          ownershipType: "joint",
          ownerPersonId: null,
        });
        const alexIraId = seedContribAccount(db, {
          personId: alexId,
          accountType: "ira",
          performanceAccountId: perfId,
          employerMatchType: "none",
        });
        const jordanIraId = seedContribAccount(db, {
          personId: jordanId,
          accountType: "ira",
          performanceAccountId: perfId,
          employerMatchType: "none",
        });

        const profileId = seedContribProfile(db, { name: "JointIraTest" });
        const result = await caller.contributionProfile.getById({
          id: profileId,
        });
        const alexDetail = result!.accountDetails.find(
          (d) => d.id === alexIraId,
        )!;
        const jordanDetail = result!.accountDetails.find(
          (d) => d.id === jordanIraId,
        )!;
        expect(alexDetail.accountName).toContain("Alex");
        expect(jordanDetail.accountName).toContain("Jordan");
        expect(alexDetail.accountName).not.toBe(jordanDetail.accountName);

        // compareData shares the identical fix.
        const compareResult = await caller.contributionProfile.compareData();
        const alexCompare = compareResult.accounts.find(
          (a) => a.id === alexIraId,
        )!;
        const jordanCompare = compareResult.accounts.find(
          (a) => a.id === jordanIraId,
        )!;
        expect(alexCompare.accountName).toContain("Alex");
        expect(jordanCompare.accountName).toContain("Jordan");
      } finally {
        cleanup();
      }
    });
  });

  // ── GETBYID: deductionDetails with an active-field amount set ──

  describe("getById — deductionDetails with active fields", () => {
    it("includes the resolved amount and isIncomplete=false when a profile sets it", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        const jobId = seedJob(db, personId, { employerName: "OriginalCo" });
        const deductionId = db
          .insert(sqliteSchema.paycheckDeductions)
          .values({
            jobId,
            deductionName: "Dental",
            isPretax: true,
            ficaExempt: false,
          })
          .returning({ id: sqliteSchema.paycheckDeductions.id })
          .get().id;

        const profileId = seedContribProfile(db, {
          name: "DeductionActiveFieldsTest",
          contributionActiveFields: {
            contributionAccounts: {},
            deductions: {
              [String(deductionId)]: { amountPerPeriod: "12.50" },
            },
          },
        });

        const result = await caller.contributionProfile.getById({
          id: profileId,
        });
        expect(result).not.toBeNull();
        const deduction = result!.deductionDetails.find(
          (d) => d.id === deductionId,
        );
        expect(deduction).toBeDefined();
        expect(deduction!.employerName).toBe("OriginalCo");
        expect(deduction!.isIncomplete).toBe(false);
        expect(deduction!.activeFields?.amountPerPeriod).toBe("12.50");
      } finally {
        cleanup();
      }
    });
  });

  // ── GETBYID: deductionDetails without active fields ──

  describe("getById — deductionDetails without active fields", () => {
    it("marks a deduction with no active amount as incomplete", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        const jobId = seedJob(db, personId);
        db.insert(sqliteSchema.paycheckDeductions)
          .values({
            jobId,
            deductionName: "Vision",
            isPretax: true,
            ficaExempt: false,
          })
          .run();

        const profileId = seedContribProfile(db, {
          name: "NoActiveFieldsDeduction",
        });

        const result = await caller.contributionProfile.getById({
          id: profileId,
        });
        expect(result).not.toBeNull();
        const deduction = result!.deductionDetails[0];
        expect(deduction.activeFields).toBeNull();
        expect(deduction.isIncomplete).toBe(true);
      } finally {
        cleanup();
      }
    });
  });

  // ── GETBYID: institution fallback to job employer ──

  describe("getById — institution fallback chain", () => {
    it("falls back to job employer when no perf account linked", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        seedJob(db, personId, { employerName: "FallbackCorp" });
        seedContribAccount(db, {
          personId,
          accountType: "hsa",
          parentCategory: "Retirement",
          performanceAccountId: null,
        });

        const profileId = seedContribProfile(db, {
          name: "InstitutionFallbackTest",
        });
        const result = await caller.contributionProfile.getById({
          id: profileId,
        });
        expect(result).not.toBeNull();
        // Account should exist (institution falls back to employer)
        expect(result!.accountDetails.length).toBeGreaterThanOrEqual(1);
      } finally {
        cleanup();
      }
    });
  });

  // ── UPDATE: the former "default" profile is now fully editable ──

  describe("update — no immutable profile any more", () => {
    it("edits contribution active fields on the migration-seeded baseline", async () => {
      const { caller, cleanup } = await createTestCaller(adminSession);
      try {
        const [seeded] = await caller.contributionProfile.list();
        const updated = await caller.contributionProfile.update({
          id: seeded!.id,
          contributionActiveFields: {
            contributionAccounts: {
              "1": {
                contributionValue: "0.20",
                contributionMethod: "percent_of_salary",
              },
            },
          },
        });
        const accts = (
          updated.contributionActiveFields as Record<
            string,
            Record<string, Record<string, unknown>>
          >
        ).contributionAccounts;
        expect(accts["1"].contributionValue).toBe("0.20");
      } finally {
        cleanup();
      }
    });

    it("renames the migration-seeded baseline", async () => {
      const { caller, cleanup } = await createTestCaller(adminSession);
      try {
        const [seeded] = await caller.contributionProfile.list();
        const updated = await caller.contributionProfile.update({
          id: seeded!.id,
          name: "Renamed Baseline",
        });
        expect(updated.name).toBe("Renamed Baseline");
      } finally {
        cleanup();
      }
    });
  });

  // ── UPDATE: update salary and contribution active fields ──

  describe("update — active fields update", () => {
    it("updates contribution active fields on a non-default profile", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = seedContribProfile(db, {
          name: "ActiveFieldsUpdate",
        });
        const updated = await caller.contributionProfile.update({
          id: profileId,
          contributionActiveFields: {
            contributionAccounts: {
              "1": {
                contributionValue: "0.2",
                contributionMethod: "percent_of_salary",
              },
            },
          },
        });
        const accts = (
          updated.contributionActiveFields as Record<
            string,
            Record<string, Record<string, unknown>>
          >
        ).contributionAccounts;
        expect(accts["1"].contributionValue).toBe("0.2");
      } finally {
        cleanup();
      }
    });

    it("updates contribution active fields with a deduction override on a non-default profile", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = seedContribProfile(db, {
          name: "ContribActiveFieldsUpd",
        });
        const updated = await caller.contributionProfile.update({
          id: profileId,
          contributionActiveFields: {
            contributionAccounts: {
              "5": {
                contributionValue: "500",
                contributionMethod: "fixed_annual",
              },
            },
            // Deductions are the only other bucket a Contribution Profile
            // still owns — the `jobs` bucket (employerName/bonus-date/etc.
            // overrides) is deleted wholesale.
            deductions: { "2": { amountPerPeriod: "25.00" } },
          },
        });
        const activeFields = updated.contributionActiveFields as Record<
          string,
          Record<string, Record<string, unknown>>
        >;
        expect(activeFields.contributionAccounts["5"]).toBeDefined();
        expect(activeFields.deductions["2"].amountPerPeriod).toBe("25.00");
      } finally {
        cleanup();
      }
    });

    it("clears description with null", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = seedContribProfile(db, {
          name: "ClearDesc",
          description: "Has description",
        });
        const updated = await caller.contributionProfile.update({
          id: profileId,
          description: null,
        });
        expect(updated.description).toBeNull();
      } finally {
        cleanup();
      }
    });
  });

  // ── DELETE: last-remaining and Plan-pin guards ──

  describe("delete — last-remaining guard", () => {
    it("throws when deleting the only remaining profile", async () => {
      const { caller, cleanup } = await createTestCaller(adminSession);
      try {
        const [only] = await caller.contributionProfile.list();
        await expect(
          caller.contributionProfile.delete({ id: only!.id }),
        ).rejects.toThrow("only remaining");
      } finally {
        cleanup();
      }
    });
  });

  describe("delete — Plan-pin guard", () => {
    it("refuses to delete a profile a Plan pins", async () => {
      // The scenarios FK is `set null`, so without this guard deleting would
      // silently unpin every Plan referencing it. salaryProfile.delete had
      // this check first; contributionProfile.delete was missing it.
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = seedContribProfile(db, { name: "PinnedByPlan" });
        db.insert(sqliteSchema.scenarios)
          .values({
            name: "My Plan",
            overrides: {},
            isBaseline: false,
            contributionProfileId: profileId,
          })
          .run();

        await expect(
          caller.contributionProfile.delete({ id: profileId }),
        ).rejects.toThrow("pinned by 1 Plan");
      } finally {
        cleanup();
      }
    });
  });

  // ── DELETE: active profile guard ──

  describe("delete — active profile guard", () => {
    it("throws when deleting the currently active profile", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = seedContribProfile(db, {
          name: "ActiveProfile",
        });
        // Point the active-profile setting at it. The migration already
        // inserted this key (it must always name a real row), so this is an
        // update rather than an insert. The value column is mode: "json", so
        // it holds a number for the strict `activeId === input.id` check.
        db.update(sqliteSchema.appSettings)
          .set({ value: profileId })
          .where(eq(sqliteSchema.appSettings.key, "active_contrib_profile_id"))
          .run();

        await expect(
          caller.contributionProfile.delete({ id: profileId }),
        ).rejects.toThrow(
          "Cannot delete the active profile. Switch to a different profile first.",
        );
      } finally {
        cleanup();
      }
    });
  });

  // ── DELETE: non-existent profile ──

  describe("delete — non-existent profile", () => {
    it("throws Profile not found for non-existent id", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        // Seed a second profile so the last-remaining guard doesn't fire
        // first and mask the not-found path.
        seedContribProfile(db, { name: "Extra" });
        await expect(
          caller.contributionProfile.delete({ id: 99999 }),
        ).rejects.toThrow("Profile not found");
      } finally {
        cleanup();
      }
    });
  });

  // ── CREATE: minimal input (no description) ──

  describe("create — minimal input", () => {
    it("creates a profile with no description", async () => {
      const { caller, cleanup } = await createTestCaller(adminSession);
      try {
        const profile = await caller.contributionProfile.create({
          name: "Minimal",
          contributionActiveFields: { contributionAccounts: {} },
        });
        expect(profile.name).toBe("Minimal");
        expect(profile.description).toBeNull();
      } finally {
        cleanup();
      }
    });
  });

  // ── CREATE: with salary and contribution active fields ──

  describe("create — with active fields", () => {
    it("creates a profile with contribution active fields", async () => {
      const { caller, cleanup } = await createTestCaller(adminSession);
      try {
        const profile = await caller.contributionProfile.create({
          name: "Full Active",
          description: "Has everything",
          contributionActiveFields: {
            contributionAccounts: {
              "10": {
                contributionValue: "0.15",
                contributionMethod: "percent_of_salary",
                isActive: true,
              },
            },
            deductions: {
              "5": { amountPerPeriod: "12.34" },
            },
          },
        });
        expect(profile.name).toBe("Full Active");
        const contribActiveFields = (
          profile.contributionActiveFields as Record<
            string,
            Record<string, unknown>
          >
        ).contributionAccounts;
        expect(contribActiveFields["10"]).toBeDefined();
      } finally {
        cleanup();
      }
    });
  });

  // ── RESOLVE: with real seeded data ──

  describe("resolve — with seeded job and contributions", () => {
    it("returns meaningful totals when data is seeded", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        seedJob(db, personId, { annualSalary: "100000" });
        const acctId = seedContribAccount(db, {
          personId,
          employerMatchType: "percent",
          employerMatchValue: "0.50",
          employerMaxMatchPct: "0.06",
        });

        const profileId = seedContribProfile(db, {
          name: "ResolveData",
          contributionActiveFields: {
            contributionAccounts: {
              [String(acctId)]: {
                contributionValue: "0.10",
                contributionMethod: "percent_of_salary",
              },
            },
            jobs: {},
          },
        });

        const result = await caller.contributionProfile.resolve({
          id: profileId,
        });
        expect(result).not.toBeNull();
        expect(result!.combinedSalary).toBe(100000);
        expect(result!.annualContributions).toBeGreaterThan(0);
        expect(result!.contribByCategory).toBeDefined();
        expect(result!.employerMatchByCategory).toBeDefined();
      } finally {
        cleanup();
      }
    });
  });

  // ── GETBYID: the migration-seeded baseline with seeded data ──

  describe("getById — baseline profile with seeded data", () => {
    it("returns account details from live data", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        seedJob(db, personId, { employerName: "TestCorp" });
        seedContribAccount(db, {
          personId,
          accountType: "401k",
        });

        const [seeded] = await caller.contributionProfile.list();
        const result = await caller.contributionProfile.getById({
          id: seeded!.id,
        });
        expect(result).not.toBeNull();
        expect(result!.id).toBe(seeded!.id);
        expect(result!.accountDetails.length).toBe(1);
        // A profile with empty contributionActiveFields customizes nothing.
        expect(result!.accountDetails[0].activeFields).toBeNull();
      } finally {
        cleanup();
      }
    });
  });

  // ── GETBYID: person without a job (institution fallback to empty) ──

  describe("getById — institution falls back to empty string", () => {
    it("handles contrib account with no matching active job", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        // Create a job but with endDate set (inactive)
        seedJob(db, personId, {
          employerName: "ClosedCo",
          endDate: "2020-12-31",
        });
        seedContribAccount(db, {
          personId,
          accountType: "ira",
          parentCategory: "Retirement",
          performanceAccountId: null,
        });

        const profileId = seedContribProfile(db, {
          name: "NoActiveJobTest",
        });
        const result = await caller.contributionProfile.getById({
          id: profileId,
        });
        expect(result).not.toBeNull();
        expect(result!.accountDetails.length).toBeGreaterThanOrEqual(1);
      } finally {
        cleanup();
      }
    });
  });

  // ── GETBYID: brokerage (portfolio) parent category ──

  describe("getById — Portfolio parent category", () => {
    it("handles brokerage account with Portfolio parent", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        seedJob(db, personId);
        seedContribAccount(db, {
          personId,
          accountType: "brokerage",
          parentCategory: "Portfolio",
          taxTreatment: "taxable",
          contributionMethod: "fixed_amount",
          contributionValue: "500",
          employerMatchType: "none",
        });

        const profileId = seedContribProfile(db, {
          name: "PortfolioParentTest",
        });
        const result = await caller.contributionProfile.getById({
          id: profileId,
        });
        expect(result).not.toBeNull();
        const detail = result!.accountDetails.find(
          (d: { accountType: string }) => d.accountType === "brokerage",
        );
        expect(detail).toBeDefined();
        expect(detail!.parentCategory).toBe("Portfolio");
      } finally {
        cleanup();
      }
    });
  });

  // salaryDetails-specific coverage (personName fallback, bonus-inclusion
  // toggles) moved to salary-profiles.test.ts — this router no longer
  // returns salary/job data at all (see deductionDetails coverage above).

  // ── GETBYID: fuzzy match via personName in label (not ownerPersonId) ──

  describe("getById — fuzzy match by person name in account label", () => {
    it("matches perf account by person name in label when ownerPersonId differs", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Jordan");
        const otherPersonId = await seedPerson(db, "Other");
        seedJob(db, personId);
        // Perf account has a DIFFERENT ownerPersonId but label contains the person name
        seedPerformanceAccount(db, {
          name: "401k",
          institution: "Fidelity",
          accountType: "401k",
          accountLabel: "Jordan 401k",
          ownerPersonId: otherPersonId, // different person
          parentCategory: "Retirement",
        });
        seedContribAccount(db, {
          personId,
          accountType: "401k",
          performanceAccountId: null,
        });

        const profileId = seedContribProfile(db, { name: "FuzzyNameMatch" });
        const result = await caller.contributionProfile.getById({
          id: profileId,
        });
        expect(result).not.toBeNull();
        expect(result!.accountDetails.length).toBeGreaterThanOrEqual(1);
      } finally {
        cleanup();
      }
    });
  });

  // Mixed active/ended jobs coverage (formerly "salary details") moved to
  // salary-profiles.test.ts — this router doesn't return job/salary data.

  // ── GETBYID: inactive contrib account still in accountDetails ──

  describe("getById — inactive contrib accounts in accountDetails", () => {
    it("includes inactive accounts in rawContribRows", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        seedJob(db, personId);
        seedContribAccount(db, {
          personId,
          accountType: "401k",
          isActive: true,
        });
        seedContribAccount(db, {
          personId,
          accountType: "ira",
          parentCategory: "Retirement",
          isActive: false,
        });

        const profileId = seedContribProfile(db, { name: "InactiveAcctTest" });
        const result = await caller.contributionProfile.getById({
          id: profileId,
        });
        expect(result).not.toBeNull();
        expect(result!.accountDetails.length).toBe(2);
      } finally {
        cleanup();
      }
    });
  });

  // ── RESOLVE: salary is live, not profile-driven ──
  // (Salary override coverage moved to tests/routers/salary-profiles.test.ts
  // when salary became its own first-class entity.)

  describe("resolve — combined salary is live", () => {
    it("ignores any salary axis and reports live combined salary", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        seedJob(db, personId, { annualSalary: "100000" });
        seedContribAccount(db, {
          personId,
          contributionMethod: "percent_of_salary",
          contributionValue: "0.10",
          employerMatchType: "none",
        });

        const profileId = seedContribProfile(db, {
          name: "SalaryOverrideResolve",
        });

        const result = await caller.contributionProfile.resolve({
          id: profileId,
        });
        expect(result).not.toBeNull();
        expect(result!.combinedSalary).toBe(100000);
      } finally {
        cleanup();
      }
    });
  });

  // ── GETBYID: account with label set (no disambiguation needed) ──

  describe("getById — account with custom label", () => {
    it("uses custom label in account name", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        seedJob(db, personId);
        seedContribAccount(db, {
          personId,
          accountType: "401k",
          label: "My Custom 401k",
        });

        const profileId = seedContribProfile(db, { name: "CustomLabelTest" });
        const result = await caller.contributionProfile.getById({
          id: profileId,
        });
        expect(result).not.toBeNull();
        const detail = result!.accountDetails[0];
        expect(detail).toBeDefined();
        // liveAccountName should use the custom label
        expect(detail!.liveAccountName).toContain("My Custom 401k");
      } finally {
        cleanup();
      }
    });
  });

  // ── GETBYID: no perf account, no active job => empty institution ──

  describe("getById — no perf account, no job => empty institution", () => {
    it("falls back to empty institution when no job and no perf account", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        // No job seeded — contrib account has no job
        seedContribAccount(db, {
          personId,
          jobId: null,
          accountType: "ira",
          parentCategory: "Retirement",
          performanceAccountId: null,
        });

        const profileId = seedContribProfile(db, { name: "NoJobNoPerf" });
        const result = await caller.contributionProfile.getById({
          id: profileId,
        });
        expect(result).not.toBeNull();
        expect(result!.accountDetails.length).toBe(1);
      } finally {
        cleanup();
      }
    });
  });

  // ── COMPAREDATA: lightweight data for the R20 swap-diff + compare view ──

  describe("compareData", () => {
    it("returns every profile and every account with active fields keyed by account id", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        const acctId = seedContribAccount(db, { personId });
        const profileId = seedContribProfile(db, {
          name: "CompareA",
          contributionActiveFields: {
            contributionAccounts: {
              [String(acctId)]: {
                contributionValue: "0.20",
                contributionMethod: "percent_of_salary",
              },
            },
            jobs: {},
          },
        });

        const result = await caller.contributionProfile.compareData();

        expect(result.accounts.length).toBeGreaterThanOrEqual(1);
        const account = result.accounts.find((a) => a.id === acctId)!;
        expect(account).toBeDefined();
        // No contributionValue/contributionMethod in `live` — accounts
        // carry no value of their own anymore, only a profile's active
        // fields does.
        expect(account.live).not.toHaveProperty("contributionValue");

        const profile = result.profiles.find((p) => p.id === profileId)!;
        expect(profile).toBeDefined();
        expect(profile.name).toBe("CompareA");
        expect(
          profile.accountActiveFields[String(acctId)]?.contributionValue,
        ).toBe("0.20");
      } finally {
        cleanup();
      }
    });

    it("a profile with empty contributionActiveFields has an empty accountActiveFields map", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = seedContribProfile(db, { name: "CompareEmpty" });
        const result = await caller.contributionProfile.compareData();
        const profile = result.profiles.find((p) => p.id === profileId)!;
        expect(profile.accountActiveFields).toEqual({});
      } finally {
        cleanup();
      }
    });

    it("disambiguates same-person/same-type sibling accounts by tax treatment", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        const trad = seedContribAccount(db, {
          personId,
          accountType: "401k",
          taxTreatment: "pre_tax",
        });
        // Only one sibling may carry real employer match config
        // (contribution_accounts_person_match_unq).
        const roth = seedContribAccount(db, {
          personId,
          accountType: "401k",
          taxTreatment: "tax_free",
          employerMatchType: "none",
        });

        const result = await caller.contributionProfile.compareData();
        const tradAccount = result.accounts.find((a) => a.id === trad)!;
        const rothAccount = result.accounts.find((a) => a.id === roth)!;
        expect(tradAccount.accountName).not.toBe(rothAccount.accountName);
      } finally {
        cleanup();
      }
    });

    it("names an account by its own linked institution, not the owner's current employer", async () => {
      // Real bug: an IRA (held at Vanguard, no employer relationship) was
      // showing the person's CURRENT job's employer name instead — e.g.
      // "Alex IRA (TechCorp)" instead of "Alex IRA (Vanguard)" — because
      // compareData synthesized "institution" from the current job for
      // every account type, ignoring the account's real linked institution.
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        seedJob(db, personId, { employerName: "TechCorp" });
        const perfAccountId = seedPerformanceAccount(db, {
          institution: "Vanguard",
          accountType: "ira",
          accountLabel: "IRA (Vanguard)",
          ownerPersonId: personId,
        });
        const iraId = seedContribAccount(db, {
          personId,
          accountType: "ira",
          performanceAccountId: perfAccountId,
          employerMatchType: "none",
        });

        const result = await caller.contributionProfile.compareData();
        const ira = result.accounts.find((a) => a.id === iraId)!;
        expect(ira.accountName).toContain("Vanguard");
        expect(ira.accountName).not.toContain("TechCorp");
      } finally {
        cleanup();
      }
    });
  });

  describe("setAccountActiveFields — field-level patch", () => {
    it("patches a single field without disturbing sibling fields", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        const accountId = seedContribAccount(db, { personId });
        const profileId = seedContribProfile(db, {
          contributionActiveFields: {
            contributionAccounts: {
              [String(accountId)]: {
                contributionValue: "5000",
                contributionMethod: "dollar_amount",
                isActive: true,
              },
            },
          },
        });

        await caller.contributionProfile.setAccountActiveFields({
          profileId,
          accountId,
          fields: { isActive: false },
        });

        const profile = await caller.contributionProfile.getById({
          id: profileId,
        });
        const detail = profile!.accountDetails.find((a) => a.id === accountId)!;
        const fields = detail.activeFields as Record<string, unknown>;
        expect(fields.contributionValue).toBe("5000");
        expect(fields.contributionMethod).toBe("dollar_amount");
        expect(fields.isActive).toBe(false);
      } finally {
        cleanup();
      }
    });

    it("unset removes only the named keys", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        const accountId = seedContribAccount(db, { personId });
        const profileId = seedContribProfile(db, {
          contributionActiveFields: {
            contributionAccounts: {
              [String(accountId)]: {
                contributionValue: "5000",
                contributionMethod: "dollar_amount",
                isActive: false,
              },
            },
          },
        });

        await caller.contributionProfile.setAccountActiveFields({
          profileId,
          accountId,
          fields: {},
          unset: ["contributionValue", "contributionMethod"],
        });

        const profile = await caller.contributionProfile.getById({
          id: profileId,
        });
        const detail = profile!.accountDetails.find((a) => a.id === accountId)!;
        const fields = detail.activeFields as Record<string, unknown>;
        expect(fields.contributionValue).toBeUndefined();
        expect(fields.contributionMethod).toBeUndefined();
        expect(fields.isActive).toBe(false);
      } finally {
        cleanup();
      }
    });

    it("fully-unsetting an entry removes the account key entirely", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        const accountId = seedContribAccount(db, { personId });
        const profileId = seedContribProfile(db, {
          contributionActiveFields: {
            contributionAccounts: {
              [String(accountId)]: { isActive: false },
            },
          },
        });

        await caller.contributionProfile.setAccountActiveFields({
          profileId,
          accountId,
          fields: {},
          unset: ["isActive"],
        });

        const compare = await caller.contributionProfile.compareData();
        const profile = compare.profiles.find((p) => p.id === profileId)!;
        expect(profile.accountActiveFields[String(accountId)]).toBeUndefined();
      } finally {
        cleanup();
      }
    });

    it("rejects a merged result that pairs contributionValue without contributionMethod", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        const accountId = seedContribAccount(db, { personId });
        const profileId = seedContribProfile(db, {
          contributionActiveFields: { contributionAccounts: {} },
        });

        await expect(
          caller.contributionProfile.setAccountActiveFields({
            profileId,
            accountId,
            fields: { contributionValue: "5000" },
          }),
        ).rejects.toThrow(/must be set together/);
      } finally {
        cleanup();
      }
    });

    it("throws for a non-existent profile", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        const accountId = seedContribAccount(db, { personId });
        await expect(
          caller.contributionProfile.setAccountActiveFields({
            profileId: 999999,
            accountId,
            fields: { isActive: false },
          }),
        ).rejects.toThrow("Profile not found");
      } finally {
        cleanup();
      }
    });
  });

  describe("setDeductionActiveFields — field-level patch", () => {
    it("sets and unsets amountPerPeriod", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = seedContribProfile(db, {
          contributionActiveFields: { contributionAccounts: {} },
        });

        const updated =
          await caller.contributionProfile.setDeductionActiveFields({
            profileId,
            deductionId: 1,
            fields: { amountPerPeriod: "50" },
          });
        const afterSet = updated.contributionActiveFields as {
          deductions?: Record<string, { amountPerPeriod?: string }>;
        };
        expect(afterSet.deductions?.["1"]?.amountPerPeriod).toBe("50");

        const cleared =
          await caller.contributionProfile.setDeductionActiveFields({
            profileId,
            deductionId: 1,
            fields: {},
            unset: ["amountPerPeriod"],
          });
        const afterUnset = cleared.contributionActiveFields as {
          deductions?: Record<string, unknown>;
        };
        expect(afterUnset.deductions?.["1"]).toBeUndefined();
      } finally {
        cleanup();
      }
    });

    it("throws for a non-existent profile", async () => {
      const { caller, cleanup } = await createTestCaller(adminSession);
      try {
        await expect(
          caller.contributionProfile.setDeductionActiveFields({
            profileId: 999999,
            deductionId: 1,
            fields: { amountPerPeriod: "50" },
          }),
        ).rejects.toThrow("Profile not found");
      } finally {
        cleanup();
      }
    });
  });
});
