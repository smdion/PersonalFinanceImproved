/**
 * Whether a contribution is also taken from bonus checks is each account's
 * own Contribution Profile election (`fromBonus`) — the one gate
 * (bonusCheckContribution). Switching the active Contribution Profile
 * changes what the bonus check takes; the Salary Profile only says how big
 * the bonus is (fictional household).
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
} from "./setup";
import { eq } from "drizzle-orm";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import { SK_ACTIVE_SALARY_PROFILE_ID } from "@/lib/constants/settings-keys";

const SALARY = 100_000;
const BONUS = 10_000; // 10% of salary

async function seedHousehold() {
  const ctx = await createTestCaller(adminSession);
  const { db } = ctx;
  const personId = await seedPerson(db, "Bonus Tester");
  const jobId = seedJob(db, personId, {
    annualSalary: String(SALARY),
    bonusPercent: "0.10",
  });
  const accountId = db
    .insert(sqliteSchema.contributionAccounts)
    .values({
      personId,
      jobId,
      accountType: "401k",
      taxTreatment: "pre_tax",
      employerMatchType: "none",
      parentCategory: "Retirement",
      isActive: true,
      ownership: "individual",
      priorYearContribAmount: "0",
    })
    .returning({ id: sqliteSchema.contributionAccounts.id })
    .get().id;
  const profile = (fromBonus: boolean) =>
    seedContributionProfile(ctx.db, {
      name: fromBonus ? "From bonus" : "Salary only",
      contributionActiveFields: {
        contributionAccounts: {
          [String(accountId)]: {
            contributionValue: "8",
            contributionMethod: "percent_of_salary",
            ...(fromBonus ? { fromBonus: true } : {}),
          },
        },
        deductions: {},
      },
    });
  return {
    ...ctx,
    personId,
    accountId,
    withBonus: profile(true),
    withoutBonus: profile(false),
  };
}

describe("contributions taken from bonus checks (fromBonus)", () => {
  it("the bonus check takes an account only under a profile that elects it", async () => {
    const h = await seedHousehold();
    try {
      const run = async (contributionProfileId: number) =>
        (
          await h.caller.paycheck.computeSummary({ contributionProfileId })
        ).people.find((p) => p.person.id === h.personId)!;

      const on = await run(h.withBonus);
      expect(on.paycheck!.bonusEstimate.bonusGross).toBeCloseTo(BONUS, 2);
      expect(on.paycheck!.bonusEstimate.bonusContributions).toBeCloseTo(
        BONUS * 0.08,
        2,
      );
      expect(on.bonusCheckAccounts).toEqual([
        { id: h.accountId, amount: BONUS * 0.08 },
      ]);

      const off = await run(h.withoutBonus);
      // Same bonus — how big it is is the Salary Profile's fact.
      expect(off.paycheck!.bonusEstimate.bonusGross).toBeCloseTo(BONUS, 2);
      expect(off.paycheck!.bonusEstimate.bonusContributions).toBe(0);
      expect(off.bonusCheckAccounts).toEqual([]);
      expect(off.paycheck!.bonusEstimate.bonusNet).toBeGreaterThan(
        on.paycheck!.bonusEstimate.bonusNet,
      );
    } finally {
      h.cleanup();
    }
  });

  it("the contribution summary's yearly amount follows the same election", async () => {
    const h = await seedHousehold();
    try {
      const annual = async (contributionProfileId: number) => {
        const r = await h.caller.contribution.computeSummary({
          contributionProfileId,
        });
        const person = r.people.find((p) => p.person.id === h.personId)!;
        return person.accountTypes.find((a) => a.categoryKey === "401k")!;
      };
      const on = await annual(h.withBonus);
      const off = await annual(h.withoutBonus);
      expect(on.bonusContrib).toBeCloseTo(BONUS * 0.08, 2);
      expect(off.bonusContrib).toBe(0);
    } finally {
      h.cleanup();
    }
  });

  it("setAccountActiveFields saves the election and removes it when turned off", async () => {
    const h = await seedHousehold();
    try {
      await h.caller.contributionProfile.setAccountActiveFields({
        profileId: h.withoutBonus,
        accountId: h.accountId,
        fields: { fromBonus: true },
      });
      const read = async () =>
        (
          (await h.caller.contributionProfile.getById({ id: h.withoutBonus }))!
            .contributionActiveFields as {
            contributionAccounts: Record<string, Record<string, unknown>>;
          }
        ).contributionAccounts[String(h.accountId)];
      expect((await read())?.fromBonus).toBe(true);
      await h.caller.contributionProfile.setAccountActiveFields({
        profileId: h.withoutBonus,
        accountId: h.accountId,
        fields: {},
        unset: ["fromBonus"],
      });
      expect((await read())?.fromBonus).toBeUndefined();
    } finally {
      h.cleanup();
    }
  });
});

describe("where the bonus goes (Salary Profile entry)", () => {
  it("is the job's entry's bonusDestination, the budget when absent", async () => {
    const h = await seedHousehold();
    try {
      const destination = async () =>
        (await h.caller.paycheck.computeSummary({})).people.find(
          (p) => p.person.id === h.personId,
        )!.bonusDestination;
      expect(await destination()).toBe("budget");

      const profiles = await h.caller.salaryProfile.list();
      const activeId = h.db
        .select()
        .from(sqliteSchema.appSettings)
        .where(eq(sqliteSchema.appSettings.key, SK_ACTIVE_SALARY_PROFILE_ID))
        .get()?.value;
      const active = profiles.find((p) => p.id === activeId)!;
      const jobId = Number(Object.keys(active.salaries)[0]);
      await h.caller.salaryProfile.patchEntry({
        id: active.id,
        jobId,
        fields: { bonusDestination: "spending" },
      });
      expect(await destination()).toBe("spending");
    } finally {
      h.cleanup();
    }
  });
});
