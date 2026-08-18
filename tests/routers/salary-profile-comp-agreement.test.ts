/**
 * REGRESSION TEST for a shipped silent-wrong-number bug.
 *
 * THE BUG. Two code paths answered "what does this household earn under this
 * Salary Profile", and they disagreed whenever a job had a nonzero bonus:
 *
 *   - `salaryProfile.getById` computed each person's `estimatedBonus` off
 *     their entry's salary and reported
 *     `combinedIncome = Σ(effectiveSalary + estimatedBonus)`.
 *   - `resolveProfile` — the path that actually feeds contribution,
 *     employer-match, budget and projection math — set
 *     `totalComp = <the entry's salary>` and discarded the bonus outright.
 *
 * So the Salary Profile editor showed a person's salary + bonus while every
 * real calculation quietly used salary alone. Nothing crashed, no test
 * failed, and the number was simply wrong by the size of the bonus.
 *
 * THE TEST. Assert the two paths agree: `getById`'s `combinedIncome` must
 * equal the sum of `totalComp` that `resolveProfile` produces for the SAME
 * profile — both paths resolve against whichever Salary Profile is
 * globally active, so the profile under test is activated first.
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
import { eq } from "drizzle-orm";
import { loadLiveContribData, resolveProfile } from "@/server/helpers";
import type { SalaryEntryMap } from "@/server/helpers";
import { SK_ACTIVE_SALARY_PROFILE_ID } from "@/lib/constants/settings-keys";

const ENTRY_SALARY = 150000;
const LIVE_SALARY = 120000;
const BONUS_PERCENT = 0.1;

/** Create a profile with these entries and set it as the globally-active
 *  one — both getById and resolveProfile only ever resolve against the
 *  active profile now, so the two paths must be compared under the same one. */
function activateProfile(
  db: Parameters<typeof seedPerson>[0],
  name: string,
  salaries: SalaryEntryMap,
): number {
  const profileId = db
    .insert(sqliteSchema.salaryProfiles)
    .values({ name, salaries })
    .returning({ id: sqliteSchema.salaryProfiles.id })
    .get().id;
  const existing = db
    .select()
    .from(sqliteSchema.appSettings)
    .where(eq(sqliteSchema.appSettings.key, SK_ACTIVE_SALARY_PROFILE_ID))
    .get();
  if (existing) {
    db.update(sqliteSchema.appSettings)
      .set({ value: String(profileId) })
      .where(eq(sqliteSchema.appSettings.key, SK_ACTIVE_SALARY_PROFILE_ID))
      .run();
  } else {
    db.insert(sqliteSchema.appSettings)
      .values({ key: SK_ACTIVE_SALARY_PROFILE_ID, value: String(profileId) })
      .run();
  }
  return profileId;
}

describe("combinedIncome agrees with resolveProfile's totalComp", () => {
  /** Sum the totalComp resolveProfile produces for the active profile. */
  async function resolvedTotalComp(
    db: Parameters<typeof loadLiveContribData>[0],
  ) {
    const live = await loadLiveContribData(db);
    const resolved = resolveProfile(
      { contributionActiveFields: { contributionAccounts: {}, jobs: {} } },
      live.contribs,
      live.jobs,
      live.jobSalaries,
    );
    return resolved.jobSalaries.reduce((s, js) => s + js.totalComp, 0);
  }

  it("agrees for a job with a complete entry earning a bonus", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const withEntry = await seedPerson(db, "WithEntry");
      const withoutEntry = await seedPerson(db, "WithoutEntry");
      const jobWithEntry = seedJob(db, withEntry, {
        annualSalary: String(LIVE_SALARY),
      });
      seedJob(db, withoutEntry, { annualSalary: String(LIVE_SALARY) });

      // A job has no salary/bonus of its own — only the one with an entry
      // in this profile earns anything; the other contributes $0.
      const salaries: SalaryEntryMap = {
        [String(jobWithEntry)]: {
          salary: ENTRY_SALARY,
          bonusPercent: BONUS_PERCENT,
          bonusMultiplier: 1,
          monthsInBonusYear: 12,
        },
      };
      const profileId = activateProfile(db, "Entry Salary", salaries);

      const view = await caller.salaryProfile.getById({ id: profileId });
      const computed = await resolvedTotalComp(db);

      // The assertion that would have caught the bug.
      expect(view!.combinedIncome).toBeCloseTo(computed, 6);

      // And pin down the value, so a change that breaks BOTH paths in the
      // same direction can't satisfy the equality above.
      const expected = ENTRY_SALARY * (1 + BONUS_PERCENT);
      expect(view!.combinedIncome).toBeCloseTo(expected, 6);
      // 165,000, not the 150,000 the old resolveProfile would have produced
      // for the entry alone (and $0 for the job with no entry).
      expect(
        view!.salaryDetails.find((d) => d.personId === withEntry)!
          .estimatedBonus,
      ).toBeCloseTo(ENTRY_SALARY * BONUS_PERCENT, 6);
      expect(
        view!.salaryDetails.find((d) => d.personId === withoutEntry)!
          .effectiveSalary,
      ).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("agrees for a bigger bonus multiplier", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "BigBonus");
      const jobId = seedJob(db, personId, {
        annualSalary: String(LIVE_SALARY),
      });

      const salaries: SalaryEntryMap = {
        [String(jobId)]: {
          salary: LIVE_SALARY,
          bonusPercent: 0.3,
          bonusMultiplier: 2,
          monthsInBonusYear: 12,
        },
      };
      const profileId = activateProfile(db, "Big Bonus", salaries);

      const view = await caller.salaryProfile.getById({ id: profileId });
      expect(view!.combinedIncome).toBeCloseTo(await resolvedTotalComp(db), 6);
      expect(view!.combinedIncome).toBeCloseTo(
        LIVE_SALARY + LIVE_SALARY * 0.3 * 2,
        6,
      );
    } finally {
      cleanup();
    }
  });

  it("agrees when the profile has no entries at all", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "NoEntry");
      seedJob(db, personId, { annualSalary: String(LIVE_SALARY) });
      const profileId = activateProfile(db, "Nothing", {});

      const view = await caller.salaryProfile.getById({ id: profileId });
      expect(view!.combinedIncome).toBeCloseTo(await resolvedTotalComp(db), 6);
      // No entry means $0 — a job has no live salary to fall back to.
      expect(view!.combinedIncome).toBe(0);
    } finally {
      cleanup();
    }
  });
});
