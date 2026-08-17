/**
 * REGRESSION TEST for a shipped silent-wrong-number bug.
 *
 * THE BUG. `paycheck.computeSummary` and `contribution.computeSummary` both
 * read a job's bonus terms (bonusPercent/bonusMultiplier/monthsInBonusYear)
 * straight off the raw `jobs` row, never through `resolveBonusTerms` — so a
 * Salary Profile that pins bonus terms (with or without also pinning salary)
 * was silently ignored by both routers, even though `salary-profiles.ts`'s
 * `getById`/`resolveProfile` (see salary-profile-comp-agreement.test.ts) and
 * `resolveCompensation` already treated a pinned bonus as real. The What-If
 * tab (and the real Paycheck page, for anyone with a pinned-bonus Salary
 * Profile active) displayed bonus-unaware net pay and contribution figures.
 *
 * THE TEST. Assert `paycheck.computeSummary`'s `bonusEstimate.bonusGross`
 * and `contribution.computeSummary`'s `bonusGross`, for a person under a
 * Salary Profile that pins ONLY bonus terms (salary stays live), equal the
 * pinned-formula bonus rather than the job's live-formula bonus. Pinned and
 * live formulas are chosen to disagree so a regression can't pass by
 * accident.
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

describe("paycheck/contribution computeSummary honor a Salary Profile's pinned bonus terms", () => {
  it("paycheck.computeSummary uses the pinned bonus, not the job's live bonus", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "BonusPinned");
      seedJob(db, personId, {
        annualSalary: String(LIVE_SALARY),
        bonusPercent: String(LIVE_BONUS_PERCENT),
        bonusMultiplier: "1.0",
        monthsInBonusYear: 12,
      });

      const salaries: SalaryEntryMap = {
        [String(personId)]: {
          bonusPercent: PINNED_BONUS_PERCENT,
          bonusMultiplier: PINNED_BONUS_MULTIPLIER,
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

  it("contribution.computeSummary uses the pinned bonus, not the job's live bonus", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "BonusPinned");
      seedJob(db, personId, {
        annualSalary: String(LIVE_SALARY),
        bonusPercent: String(LIVE_BONUS_PERCENT),
        bonusMultiplier: "1.0",
        monthsInBonusYear: 12,
      });

      const salaries: SalaryEntryMap = {
        [String(personId)]: {
          bonusPercent: PINNED_BONUS_PERCENT,
          bonusMultiplier: PINNED_BONUS_MULTIPLIER,
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
      // computed off of it — a pre-existing two-step quirk this fix doesn't
      // change, just makes bonus-terms-aware instead of job-live-only.
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

  it("paycheck.computeSummary: sandbox salary beats a Salary Profile's pinned salary", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "Sandboxed");
      seedJob(db, personId, { annualSalary: String(LIVE_SALARY) });

      const salaries: SalaryEntryMap = {
        [String(personId)]: { salary: PROFILE_SALARY },
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

  it("contribution.computeSummary: sandbox bonus terms beat a Salary Profile's pinned bonus terms", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "Sandboxed");
      seedJob(db, personId, {
        annualSalary: String(LIVE_SALARY),
        bonusPercent: String(LIVE_BONUS_PERCENT),
        bonusMultiplier: "1.0",
        monthsInBonusYear: 12,
      });

      const salaries: SalaryEntryMap = {
        [String(personId)]: { bonusPercent: PINNED_BONUS_PERCENT },
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
