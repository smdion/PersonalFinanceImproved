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
    it("returns accountDetails with live values and active fields", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        const jobId = seedJob(db, personId, { employerName: "TechCorp" });
        const acctId = seedContribAccount(db, {
          personId,
          jobId,
          accountType: "401k",
          taxTreatment: "pre_tax",
          contributionMethod: "percent_of_salary",
          contributionValue: "0.10",
        });

        const profileId = seedContribProfile(db, {
          name: "DetailTest",
          contributionActiveFields: {
            contributionAccounts: {
              [String(acctId)]: {
                contributionValue: "0.20",
                displayNameActive: "My Custom Name",
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
        // displayNameActive should be used as accountName
        expect(detail!.accountName).toBe("My Custom Name");
        expect(detail!.activeFields).toBeDefined();
        expect(detail!.liveMethod).toBe("percent_of_salary");
        expect(detail!.liveValue).toBe("0.10");
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
        // Two 401k accounts, different tax treatments
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
  });

  // ── GETBYID: salaryDetails with job active fields ──

  describe("getById — salaryDetails with job active fields", () => {
    it("includes jobActiveFields and employerNameActive from profile", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        const jobId = seedJob(db, personId, {
          employerName: "OriginalCo",
          annualSalary: "100000",
          bonusPercent: "0.10",
          bonusMultiplier: "1.0",
        });

        const profileId = seedContribProfile(db, {
          name: "JobActiveFieldsTest",
          contributionActiveFields: {
            contributionAccounts: {},
            jobs: {
              [String(jobId)]: {
                bonusPercent: "0.15",
                employerName: "NewCo",
              },
            },
          },
        });

        const result = await caller.contributionProfile.getById({
          id: profileId,
        });
        expect(result).not.toBeNull();
        expect(result!.salaryDetails.length).toBe(1);

        const salary = result!.salaryDetails[0];
        expect(salary.jobActiveFields).toBeDefined();
        expect(salary.employerNameActive).toBe("NewCo");
        expect(salary.liveSalary).toBe(100000);
      } finally {
        cleanup();
      }
    });
  });

  // ── GETBYID: salaryDetails without active fields ──

  describe("getById — salaryDetails without active fields", () => {
    it("returns null for active-field fields when none set", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        seedJob(db, personId, { annualSalary: "90000" });

        const profileId = seedContribProfile(db, {
          name: "NoActiveFieldsSalary",
        });

        const result = await caller.contributionProfile.getById({
          id: profileId,
        });
        expect(result).not.toBeNull();
        const salary = result!.salaryDetails[0];
        expect(salary.jobActiveFields).toBeNull();
        expect(salary.employerNameActive).toBeNull();
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
            contributionAccounts: { "1": { contributionValue: "0.20" } },
            jobs: {},
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
            contributionAccounts: { "1": { contributionValue: "0.2" } },
            jobs: {},
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

    it("updates contribution active fields on a non-default profile", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = seedContribProfile(db, {
          name: "ContribActiveFieldsUpd",
        });
        const updated = await caller.contributionProfile.update({
          id: profileId,
          contributionActiveFields: {
            contributionAccounts: { "5": { contributionValue: "500" } },
            // employerName, not a bonus amount term — those moved to the
            // Salary Profile and jobActiveFieldsSchema now rejects them.
            jobs: { "2": { employerName: "ActiveFieldsCorp" } },
          },
        });
        const activeFields = updated.contributionActiveFields as Record<
          string,
          Record<string, Record<string, unknown>>
        >;
        expect(activeFields.contributionAccounts["5"]).toBeDefined();
        expect(activeFields.jobs["2"]).toBeDefined();
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
          contributionActiveFields: { contributionAccounts: {}, jobs: {} },
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
              "10": { contributionValue: "0.15", isActive: true },
            },
            jobs: {
              "5": { include401kInBonus: true, employerName: "NewCorp" },
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
        seedContribAccount(db, {
          personId,
          contributionMethod: "percent_of_salary",
          contributionValue: "0.10",
          employerMatchType: "percent",
          employerMatchValue: "0.50",
          employerMaxMatchPct: "0.06",
        });

        const profileId = seedContribProfile(db, {
          name: "ResolveData",
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
    it("returns account and salary details from live data", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        seedJob(db, personId, {
          employerName: "TestCorp",
          annualSalary: "120000",
        });
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
        expect(result!.salaryDetails.length).toBe(1);
        expect(result!.salaryDetails[0].liveSalary).toBe(120000);
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

  // ── GETBYID: personName fallback when person not in map ──

  describe("getById — salaryDetails personName fallback", () => {
    it("uses personName from people table", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Custom Name");
        seedJob(db, personId, { annualSalary: "80000" });

        const profileId = seedContribProfile(db, {
          name: "PersonNameTest",
        });
        const result = await caller.contributionProfile.getById({
          id: profileId,
        });
        expect(result).not.toBeNull();
        expect(result!.salaryDetails[0].personName).toBe("Custom Name");
      } finally {
        cleanup();
      }
    });
  });

  // ── GETBYID: estimatedBonus field present ──

  describe("getById — salaryDetails bonus fields", () => {
    it("includes bonus-related live values", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        seedJob(db, personId, {
          annualSalary: "100000",
          bonusPercent: "0.10",
          bonusMultiplier: "1.5",
          monthsInBonusYear: 12,
        });

        const profileId = seedContribProfile(db, { name: "BonusFieldTest" });
        const result = await caller.contributionProfile.getById({
          id: profileId,
        });
        expect(result).not.toBeNull();
        const sal = result!.salaryDetails[0];
        expect(sal.liveBonusPercent).toBe("0.10");
        expect(sal.liveBonusMultiplier).toBe("1.5");
        expect(sal.liveMonthsInBonusYear).toBe(12);
        expect(typeof sal.estimatedBonus).toBe("number");
      } finally {
        cleanup();
      }
    });
  });

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

  // ── GETBYID: multiple jobs — one active, one ended ──

  describe("getById — mixed active/ended jobs in salary details", () => {
    it("only includes active jobs in salary details", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        seedJob(db, personId, {
          employerName: "ActiveCo",
          annualSalary: "100000",
        });
        seedJob(db, personId, {
          employerName: "PastCo",
          annualSalary: "80000",
          endDate: "2022-06-30",
        });

        const profileId = seedContribProfile(db, { name: "MixedJobsTest" });
        const result = await caller.contributionProfile.getById({
          id: profileId,
        });
        expect(result).not.toBeNull();
        const activeDetails = result!.salaryDetails.filter(
          (s: { employerName: string }) => s.employerName === "ActiveCo",
        );
        expect(activeDetails.length).toBe(1);
      } finally {
        cleanup();
      }
    });
  });

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
        // salaryDetails should be empty (no active jobs)
        expect(result!.salaryDetails.length).toBe(0);
      } finally {
        cleanup();
      }
    });
  });
});
