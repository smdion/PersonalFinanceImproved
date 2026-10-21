/* eslint-disable no-restricted-syntax -- the test SQLite db stands in for the app Db type (Drizzle dialect cast) */
/**
 * loadContributionMix — what the paycheck setup sends to each tracked
 * account this year, used to split a deposit a feed reports as one amount.
 * It follows the contribution summary's rules: an account set to be taken
 * from bonus checks (fromBonus) counts what the bonus check takes; a
 * paycheck's worth is the regular paychecks' part. Fictional household.
 */
import "../routers/setup-mocks";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestCaller,
  seedPerson,
  seedJob,
  seedPerformanceAccount,
  seedContributionProfile,
} from "../routers/setup";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import { loadContributionMix } from "@/server/helpers/contribution-mix";
import { SK_ACTIVE_CONTRIB_PROFILE_ID } from "@/lib/constants/settings-keys";
import type { Db } from "@/server/helpers/transforms";

async function mixFor(fromBonus: boolean, asOf: Date) {
  const ctx = await createTestCaller();
  const { db } = ctx;
  const personId = await seedPerson(db, "Mix Person");
  const jobId = seedJob(db, personId, {
    annualSalary: "100000",
    bonusPercent: "0.1",
    bonusMonth: 3,
    bonusDayOfMonth: 15,
  });
  const perfId = seedPerformanceAccount(db, { ownerPersonId: personId });
  const accountId = db
    .insert(sqliteSchema.contributionAccounts)
    .values({
      personId,
      jobId,
      accountType: "401k",
      parentCategory: "Retirement",
      taxTreatment: "pre_tax",
      employerMatchType: "none",
      isActive: true,
      performanceAccountId: perfId,
    })
    .returning({ id: sqliteSchema.contributionAccounts.id })
    .get().id;
  const profileId = seedContributionProfile(db, {
    name: "Mix profile",
    isActive: false,
    contributionActiveFields: {
      contributionAccounts: {
        [String(accountId)]: {
          contributionValue: "10",
          contributionMethod: "percent_of_salary",
          ...(fromBonus ? { fromBonus: true } : {}),
        },
      },
      deductions: {},
    },
  });
  db.delete(sqliteSchema.appSettings)
    .where(eq(sqliteSchema.appSettings.key, SK_ACTIVE_CONTRIB_PROFILE_ID))
    .run();
  db.insert(sqliteSchema.appSettings)
    .values({ key: SK_ACTIVE_CONTRIB_PROFILE_ID, value: profileId })
    .run();
  const mix = (await loadContributionMix(db as unknown as Db, asOf)).get(
    perfId,
  )!;
  ctx.cleanup();
  return mix;
}

describe("loadContributionMix", () => {
  it("counts what the bonus check takes only for an account set to fromBonus", async () => {
    const on = await mixFor(true, new Date(2026, 5, 15));
    const off = await mixFor(false, new Date(2026, 5, 15));
    // 10% of $100,000, plus 10% of the $10,000 bonus when taken from it.
    expect(on.employeePreTax).toBeCloseTo(11_000, 0);
    expect(off.employeePreTax).toBeCloseTo(10_000, 0);
  });

  it("a paycheck's worth leaves out the bonus check's part", async () => {
    const on = await mixFor(true, new Date(2026, 5, 15));
    const off = await mixFor(false, new Date(2026, 5, 15));
    expect(on.perContribution).toBeCloseTo(off.perContribution, 2);
  });

  it("the bonus check's part is still to come only before its date", async () => {
    const before = await mixFor(true, new Date(2026, 1, 1));
    const beforeOff = await mixFor(false, new Date(2026, 1, 1));
    const after = await mixFor(true, new Date(2026, 5, 15));
    const afterOff = await mixFor(false, new Date(2026, 5, 15));
    expect(before.remainingThisYear - beforeOff.remainingThisYear).toBeCloseTo(
      1_000,
      0,
    );
    expect(after.remainingThisYear).toBeCloseTo(afterOff.remainingThisYear, 2);
  });
});
