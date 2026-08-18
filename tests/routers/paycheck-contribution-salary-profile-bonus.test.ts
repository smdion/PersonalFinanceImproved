/**
 * `paycheck.computeSummary` and `contribution.computeSummary` both resolve
 * a job's bonus terms through `resolveCompensation`, so a Salary Profile
 * with a different bonus percent/multiplier for the same job produces a
 * genuinely different bonus — not the job's default/active-profile bonus.
 *
 * A job has no bonus terms of its own any more: seedJob's
 * bonusPercent/bonusMultiplier/monthsInBonusYear convenience fields (see
 * setup.ts) write a complete entry into the shared DEFAULT active Salary
 * Profile. These tests compare that default entry ("no salaryProfileId
 * passed" falls back to the active profile — see
 * loadEffectiveSalaryProfile) against an explicitly-passed alternate
 * profile with different, complete bonus terms for the same job.
 */
import "./setup-mocks";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

import { createTestCaller, adminSession, seedPerson, seedJob } from "./setup";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import type { SalaryEntryMap } from "@/server/helpers";

const LIVE_SALARY = 120000;
const LIVE_BONUS_PERCENT = 0.1;
const PINNED_BONUS_PERCENT = 0.3;
const PINNED_BONUS_MULTIPLIER = 2;

describe("paycheck/contribution computeSummary honor a different Salary Profile's bonus terms", () => {
  it("paycheck.computeSummary uses the explicit profile's bonus, not the default profile's", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "BonusPinned");
      const jobId = seedJob(db, personId, {
        annualSalary: String(LIVE_SALARY),
        bonusPercent: String(LIVE_BONUS_PERCENT),
        bonusMultiplier: "1.0",
        monthsInBonusYear: 12,
      });

      const salaries: SalaryEntryMap = {
        [String(jobId)]: {
          salary: LIVE_SALARY,
          bonusPercent: PINNED_BONUS_PERCENT,
          bonusMultiplier: PINNED_BONUS_MULTIPLIER,
          monthsInBonusYear: 12,
        },
      };
      const profileId = db
        .insert(sqliteSchema.salaryProfiles)
        .values({ name: "Big Bonus", salaries })
        .returning({ id: sqliteSchema.salaryProfiles.id })
        .get().id;

      const result = await caller.paycheck.computeSummary({
        salaryProfileId: profileId,
      });
      const person = result.people.find((p) => p.person.id === personId)!;

      const pinnedBonus =
        LIVE_SALARY * PINNED_BONUS_PERCENT * PINNED_BONUS_MULTIPLIER;
      const liveBonus = LIVE_SALARY * LIVE_BONUS_PERCENT;

      expect(person.paycheck!.bonusEstimate.bonusGross).toBeCloseTo(
        pinnedBonus,
        2,
      );
      expect(person.paycheck!.bonusEstimate.bonusGross).not.toBeCloseTo(
        liveBonus,
        2,
      );
    } finally {
      cleanup();
    }
  });

  it("contribution.computeSummary uses the explicit profile's bonus, not the default profile's", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "BonusPinned");
      const jobId = seedJob(db, personId, {
        annualSalary: String(LIVE_SALARY),
        bonusPercent: String(LIVE_BONUS_PERCENT),
        bonusMultiplier: "1.0",
        monthsInBonusYear: 12,
      });

      const salaries: SalaryEntryMap = {
        [String(jobId)]: {
          salary: LIVE_SALARY,
          bonusPercent: PINNED_BONUS_PERCENT,
          bonusMultiplier: PINNED_BONUS_MULTIPLIER,
          monthsInBonusYear: 12,
        },
      };
      const profileId = db
        .insert(sqliteSchema.salaryProfiles)
        .values({ name: "Big Bonus", salaries })
        .returning({ id: sqliteSchema.salaryProfiles.id })
        .get().id;

      const result = await caller.contribution.computeSummary({
        salaryProfileId: profileId,
      });
      const person = result.people.find((p) => p.person.id === personId)!;

      // includeBonusInContributions defaults true, so this router's `salary`
      // is effective income (base + bonus) before the final bonusGross is
      // computed off of it — a pre-existing two-step quirk, unrelated to
      // which profile's terms are in effect.
      const pinnedEffective =
        LIVE_SALARY +
        LIVE_SALARY * PINNED_BONUS_PERCENT * PINNED_BONUS_MULTIPLIER;
      const pinnedBonus =
        pinnedEffective * PINNED_BONUS_PERCENT * PINNED_BONUS_MULTIPLIER;
      const liveEffective = LIVE_SALARY + LIVE_SALARY * LIVE_BONUS_PERCENT;
      const liveBonus = liveEffective * LIVE_BONUS_PERCENT;

      expect(person.bonusGross).toBeCloseTo(pinnedBonus, 2);
      expect(person.bonusGross).not.toBeCloseTo(liveBonus, 2);
    } finally {
      cleanup();
    }
  });
});

describe("sandboxSalaryEntries is the highest precedence tier", () => {
  const PROFILE_SALARY = 150000;
  const SANDBOX_SALARY = 200000;

  it("paycheck.computeSummary: sandbox salary beats the Salary Profile's entry", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "Sandboxed");
      const jobId = seedJob(db, personId, {
        annualSalary: String(LIVE_SALARY),
      });

      const salaries: SalaryEntryMap = {
        [String(jobId)]: {
          salary: PROFILE_SALARY,
          bonusPercent: 0,
          bonusMultiplier: 1,
          monthsInBonusYear: 12,
        },
      };
      const profileId = db
        .insert(sqliteSchema.salaryProfiles)
        .values({ name: "Pinned", salaries })
        .returning({ id: sqliteSchema.salaryProfiles.id })
        .get().id;

      const withoutSandbox = await caller.paycheck.computeSummary({
        salaryProfileId: profileId,
      });
      const withSandbox = await caller.paycheck.computeSummary({
        salaryProfileId: profileId,
        sandboxSalaryEntries: {
          [String(personId)]: { salary: SANDBOX_SALARY },
        },
      });

      expect(
        withoutSandbox.people.find((p) => p.person.id === personId)!.salary,
      ).toBeCloseTo(PROFILE_SALARY, 2);
      expect(
        withSandbox.people.find((p) => p.person.id === personId)!.salary,
      ).toBeCloseTo(SANDBOX_SALARY, 2);
    } finally {
      cleanup();
    }
  });

  it("contribution.computeSummary: sandbox bonus terms beat the Salary Profile's entry", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "Sandboxed");
      const jobId = seedJob(db, personId, {
        annualSalary: String(LIVE_SALARY),
        bonusPercent: String(LIVE_BONUS_PERCENT),
        bonusMultiplier: "1.0",
        monthsInBonusYear: 12,
      });

      const salaries: SalaryEntryMap = {
        [String(jobId)]: {
          salary: LIVE_SALARY,
          bonusPercent: PINNED_BONUS_PERCENT,
          bonusMultiplier: 1,
          monthsInBonusYear: 12,
        },
      };
      const profileId = db
        .insert(sqliteSchema.salaryProfiles)
        .values({ name: "Pinned Bonus", salaries })
        .returning({ id: sqliteSchema.salaryProfiles.id })
        .get().id;

      const sandboxBonusPercent = 0.5;
      const result = await caller.contribution.computeSummary({
        salaryProfileId: profileId,
        sandboxSalaryEntries: {
          [String(personId)]: { bonusPercent: sandboxBonusPercent },
        },
      });
      const person = result.people.find((p) => p.person.id === personId)!;

      // Same two-step effective-income quirk noted above.
      const sandboxEffective =
        LIVE_SALARY + LIVE_SALARY * sandboxBonusPercent * 1.0;
      const expectedBonus = sandboxEffective * sandboxBonusPercent * 1.0;

      expect(person.bonusGross).toBeCloseTo(expectedBonus, 2);
    } finally {
      cleanup();
    }
  });
});
