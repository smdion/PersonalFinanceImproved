/**
 * REGRESSION TEST for a shipped silent-wrong-number bug.
 *
 * THE BUG. Two code paths answered "what does this household earn under this
 * Salary Profile", and they disagreed whenever a salary was pinned:
 *
 *   - `salaryProfile.getById` computed each person's `estimatedBonus` off
 *     their effective (pinned) salary and reported
 *     `combinedIncome = Σ(effectiveSalary + estimatedBonus)`.
 *   - `resolveProfile` — the path that actually feeds contribution,
 *     employer-match, budget and projection math — set
 *     `totalComp = <the pinned salary>` and discarded the bonus outright.
 *
 * So the Salary Profile editor showed a pinned person's salary + bonus while
 * every real calculation quietly used salary alone. Nothing crashed, no test
 * failed, and the number was simply wrong by the size of the bonus.
 *
 * THE TEST. Assert the two paths agree: `getById`'s `combinedIncome` must
 * equal the sum of `totalComp` that `resolveProfile` produces for the same
 * profile, for a household containing a pinned-salary-plus-bonus person.
 * This fails against the old code (165,000 vs 150,000 for that person) and
 * passes against the fix, which routes both through `resolveCompensation`.
 *
 * It is deliberately an equality between two independently-reached numbers
 * rather than an assertion about either one, because the failure mode is
 * divergence — a future change that breaks only one path is exactly what
 * this must catch.
 */
import "./setup-mocks";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

import { createTestCaller, adminSession, seedPerson, seedJob } from "./setup";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import { loadLiveContribData, resolveProfile } from "@/server/helpers";
import type { SalaryEntryMap } from "@/server/helpers";

const PINNED_SALARY = 150000;
const LIVE_SALARY = 120000;
const BONUS_PERCENT = 0.1;

describe("combinedIncome agrees with resolveProfile's totalComp", () => {
  /** Sum the totalComp resolveProfile produces for a stored profile. */
  async function resolvedTotalComp(
    db: Parameters<typeof loadLiveContribData>[0],
    salaries: SalaryEntryMap,
  ) {
    const live = await loadLiveContribData(db);
    const resolved = resolveProfile(
      { contributionActiveFields: { contributionAccounts: {}, jobs: {} } },
      salaries,
      live.contribs,
      live.jobs,
      live.jobSalaries,
    );
    return resolved.jobSalaries.reduce((s, js) => s + js.totalComp, 0);
  }

  it("agrees for a pinned salary that also earns a bonus", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const pinned = await seedPerson(db, "Pinned");
      const unpinned = await seedPerson(db, "Unpinned");
      for (const personId of [pinned, unpinned]) {
        seedJob(db, personId, {
          annualSalary: String(LIVE_SALARY),
          bonusPercent: String(BONUS_PERCENT),
          bonusMultiplier: "1.0",
          monthsInBonusYear: 12,
        });
      }

      const salaries: SalaryEntryMap = {
        [String(pinned)]: { salary: PINNED_SALARY },
      };
      const profileId = db
        .insert(sqliteSchema.salaryProfiles)
        .values({ name: "Pinned Salary", salaries })
        .returning({ id: sqliteSchema.salaryProfiles.id })
        .get().id;

      const view = await caller.salaryProfile.getById({ id: profileId });
      const computed = await resolvedTotalComp(db, salaries);

      // The assertion that would have caught the bug.
      expect(view!.combinedIncome).toBeCloseTo(computed, 6);

      // And pin down the value, so a change that breaks BOTH paths in the
      // same direction can't satisfy the equality above.
      const expected =
        PINNED_SALARY * (1 + BONUS_PERCENT) + LIVE_SALARY * (1 + BONUS_PERCENT);
      expect(view!.combinedIncome).toBeCloseTo(expected, 6);
      // 165,000, not the 150,000 the old resolveProfile produced.
      expect(
        view!.salaryDetails.find((d) => d.personId === pinned)!.estimatedBonus,
      ).toBeCloseTo(PINNED_SALARY * BONUS_PERCENT, 6);
    } finally {
      cleanup();
    }
  });

  it("agrees when bonus TERMS are pinned instead of salary", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "BonusPinned");
      seedJob(db, personId, {
        annualSalary: String(LIVE_SALARY),
        bonusPercent: String(BONUS_PERCENT),
        bonusMultiplier: "1.0",
        monthsInBonusYear: 12,
      });

      const salaries: SalaryEntryMap = {
        [String(personId)]: { bonusPercent: 0.3, bonusMultiplier: 2 },
      };
      const profileId = db
        .insert(sqliteSchema.salaryProfiles)
        .values({ name: "Big Bonus", salaries })
        .returning({ id: sqliteSchema.salaryProfiles.id })
        .get().id;

      const view = await caller.salaryProfile.getById({ id: profileId });
      expect(view!.combinedIncome).toBeCloseTo(
        await resolvedTotalComp(db, salaries),
        6,
      );
      expect(view!.combinedIncome).toBeCloseTo(
        LIVE_SALARY + LIVE_SALARY * 0.3 * 2,
        6,
      );
    } finally {
      cleanup();
    }
  });

  it("agrees when the profile pins nothing at all", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "Live");
      seedJob(db, personId, {
        annualSalary: String(LIVE_SALARY),
        bonusPercent: String(BONUS_PERCENT),
        bonusMultiplier: "1.0",
        monthsInBonusYear: 12,
      });
      const profileId = db
        .insert(sqliteSchema.salaryProfiles)
        .values({ name: "Nothing Pinned", salaries: {} })
        .returning({ id: sqliteSchema.salaryProfiles.id })
        .get().id;

      const view = await caller.salaryProfile.getById({ id: profileId });
      expect(view!.combinedIncome).toBeCloseTo(
        await resolvedTotalComp(db, {}),
        6,
      );
      expect(view!.combinedIncome).toBeCloseTo(
        LIVE_SALARY * (1 + BONUS_PERCENT),
        6,
      );
    } finally {
      cleanup();
    }
  });
});
