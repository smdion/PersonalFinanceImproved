/**
 * T15 — build-engine-payload.ts had zero test coverage. This is the module
 * that turns raw DB rows into the engine's ProjectionInput; every retirement/
 * projection router endpoint depends on it. Covers the core wiring for
 * single- and two-person households: currentAge/retirementAge resolution,
 * startingBalances aggregation from the latest snapshot, contributionSpecs
 * construction (incl. per-person personId — see T24/H10), and
 * catchupGroupParticipants population.
 *
 * Not exhaustive of all 1197 lines (contribution-profile batching, bracket
 * rate estimation, and profile-switch salary logic — called out in the
 * review as the riskiest untested branches — still have no dedicated
 * coverage here; this locks in the base wiring only).
 */
import "../routers/setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestCaller,
  seedPerson,
  seedJob,
  seedPerformanceAccount,
  seedSnapshot,
} from "../routers/setup";
import {
  fetchRetirementData,
  buildEnginePayload,
} from "@/server/retirement/build-engine-payload";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "@/lib/db/schema-sqlite";

async function getSchema() {
  return await import("@/lib/db/schema");
}

async function markPrimary(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  personId: number,
) {
  const schema = await getSchema();
  const { eq } = await import("drizzle-orm");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic schema import requires runtime cast
  (db as any)
    .update(schema.people)
    .set({ isPrimaryUser: true })
    .where(eq(schema.people.id, personId))
    .run();
}

async function insertBudgetProfile(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  name: string,
) {
  const schema = await getSchema();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic schema import requires runtime cast
  return (db as any)
    .insert(schema.budgetProfiles)
    .values({ name, isActive: true, columnLabels: ["Standard"] })
    .returning({ id: schema.budgetProfiles.id })
    .get().id as number;
}

async function insertBudgetItem(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  profileId: number,
  category: string,
  subcategory: string,
  amounts: number[],
) {
  const schema = await getSchema();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic schema import requires runtime cast
  (db as any)
    .insert(schema.budgetItems)
    .values({ profileId, category, subcategory, amounts })
    .run();
}

async function seedRetirementSettings(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  personId: number,
  overrides: Record<string, unknown> = {},
) {
  const schema = await getSchema();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic schema import requires runtime cast
  (db as any)
    .insert(schema.retirementSettings)
    .values({
      personId,
      retirementAge: 65,
      endAge: 95,
      returnAfterRetirement: "0.04",
      annualInflation: "0.03",
      salaryAnnualIncrease: "0.03",
      withdrawalRate: "0.04",
      socialSecurityMonthly: "2500",
      ssStartAge: 67,
      filingStatus: "MFJ",
      ...overrides,
    })
    .run();
}

/** Seeds a raw contribution account (no value of its own) and returns its
 * id — pair with seedContributionProfileFor to give it a value. */
async function seedContributionAccount(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  personId: number,
  jobId: number | null,
  perfAccountId: number,
  overrides: Record<string, unknown> = {},
): Promise<number> {
  const schema = await getSchema();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic schema import requires runtime cast
  const acct = (db as any)
    .insert(schema.contributionAccounts)
    .values({
      personId,
      jobId,
      accountType: "401k",
      parentCategory: "Retirement",
      taxTreatment: "pre_tax",
      employerMatchType: "percent_of_contrib",
      employerMatchValue: "0.50",
      employerMaxMatchPct: "0.06",
      isActive: true,
      performanceAccountId: perfAccountId,
      ...overrides,
    })
    .returning({ id: schema.contributionAccounts.id })
    .get();
  return acct.id;
}

/** Seeds a Contribution Profile giving each of the given account ids a
 * percent_of_salary value of 0.10 — accounts carry no value of their own. */
async function seedContributionProfileForAccounts(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  accountIds: number[],
): Promise<number> {
  const schema = await getSchema();
  const contributionAccounts: Record<string, unknown> = {};
  for (const id of accountIds) {
    contributionAccounts[String(id)] = {
      contributionValue: "0.10",
      contributionMethod: "percent_of_salary",
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic schema import requires runtime cast
  const profile = (db as any)
    .insert(schema.contributionProfiles)
    .values({
      name: "Test Contrib Profile",
      contributionActiveFields: { contributionAccounts, jobs: {} },
    })
    .returning({ id: schema.contributionProfiles.id })
    .get();
  return profile.id;
}

describe("buildEnginePayload — single-person household", () => {
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let personId: number;
  let contributionProfileId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    db = ctx.db;
    cleanup = ctx.cleanup;

    personId = await seedPerson(db, "Alex", "1985-06-15");
    await markPrimary(db, personId);
    await seedRetirementSettings(db, personId);
    const jobId = seedJob(db, personId, { annualSalary: "150000" });

    const profileId = await insertBudgetProfile(db, "Main Budget");
    await insertBudgetItem(db, profileId, "Essentials", "Rent", [3000]);

    const perfAcctId = seedPerformanceAccount(db, {
      parentCategory: "Retirement",
      accountType: "401k",
      ownerPersonId: personId,
    });
    seedSnapshot(db, "2025-06-15", [
      { performanceAccountId: perfAcctId, amount: "250000", taxType: "preTax" },
    ]);
    const contribAcctId = await seedContributionAccount(
      db,
      personId,
      jobId,
      perfAcctId,
    );
    contributionProfileId = await seedContributionProfileForAccounts(db, [
      contribAcctId,
    ]);
  });

  afterAll(() => cleanup());

  it("resolves currentAge and retirementAge from settings", async () => {
    const data = await fetchRetirementData(db, { contributionProfileId });
    const payload = await buildEnginePayload(db, data, {
      contributionProfileId,
    });

    // Age is derived from dateOfBirth at fetch time — assert it's in the
    // right ballpark rather than hardcoding an exact age that drifts with
    // "today"'s date.
    expect(payload.age).toBeGreaterThanOrEqual(39);
    expect(payload.age).toBeLessThanOrEqual(41);
    expect(payload.baseEngineInput.retirementAge).toBe(65);
    expect(payload.hasMultiplePeople).toBe(false);
  });

  it("aggregates starting balances from the latest snapshot", async () => {
    const data = await fetchRetirementData(db, { contributionProfileId });
    const payload = await buildEnginePayload(db, data, {
      contributionProfileId,
    });

    expect(payload.portfolioTotal).toBe(250000);
    expect(payload.baseEngineInput.startingBalances.preTax).toBe(250000);
  });

  it("builds a contribution spec with the seeded personId", async () => {
    const data = await fetchRetirementData(db, { contributionProfileId });
    const payload = await buildEnginePayload(db, data, {
      contributionProfileId,
    });

    expect(payload.contributionSpecs.length).toBeGreaterThan(0);
    expect(payload.contributionSpecs[0]?.personId).toBe(personId);
    expect(payload.contributionSpecs[0]?.category).toBe("401k");
  });
});

describe("buildEnginePayload — two-person household (H10/T24 wiring)", () => {
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let personAId: number;
  let personBId: number;
  let contributionProfileId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    db = ctx.db;
    cleanup = ctx.cleanup;

    // Person A: age ~40. Person B: age ~61 (catch-up eligible territory).
    personAId = await seedPerson(db, "Alex", "1985-01-01");
    personBId = await seedPerson(db, "Sam", "1964-01-01");
    await markPrimary(db, personAId);
    await seedRetirementSettings(db, personAId);
    await seedRetirementSettings(db, personBId);

    const jobAId = seedJob(db, personAId, { annualSalary: "150000" });
    const jobBId = seedJob(db, personBId, { annualSalary: "120000" });

    const profileId = await insertBudgetProfile(db, "Main Budget");
    await insertBudgetItem(db, profileId, "Essentials", "Rent", [3000]);

    const perfAcctA = seedPerformanceAccount(db, {
      parentCategory: "Retirement",
      accountType: "401k",
      ownerPersonId: personAId,
      name: "401k A",
    });
    const perfAcctB = seedPerformanceAccount(db, {
      parentCategory: "Retirement",
      accountType: "401k",
      ownerPersonId: personBId,
      name: "401k B",
    });
    seedSnapshot(db, "2025-06-15", [
      { performanceAccountId: perfAcctA, amount: "250000", taxType: "preTax" },
      { performanceAccountId: perfAcctB, amount: "400000", taxType: "preTax" },
    ]);
    const contribAcctA = await seedContributionAccount(
      db,
      personAId,
      jobAId,
      perfAcctA,
    );
    const contribAcctB = await seedContributionAccount(
      db,
      personBId,
      jobBId,
      perfAcctB,
    );
    contributionProfileId = await seedContributionProfileForAccounts(db, [
      contribAcctA,
      contribAcctB,
    ]);
  });

  afterAll(() => cleanup());

  it("marks hasMultiplePeople and includes both people in perPersonSettings", async () => {
    const data = await fetchRetirementData(db, { contributionProfileId });
    const payload = await buildEnginePayload(db, data, {
      contributionProfileId,
    });

    expect(payload.hasMultiplePeople).toBe(true);
    expect(payload.perPersonSettings.length).toBe(2);
  });

  it("populates catchupGroupParticipants with both people's birth years (H10)", async () => {
    const data = await fetchRetirementData(db, { contributionProfileId });
    const payload = await buildEnginePayload(db, data, {
      contributionProfileId,
    });

    const participants =
      payload.baseEngineInput.catchupGroupParticipants?.["401k"];
    expect(participants).toBeDefined();
    expect(participants?.length).toBe(2);
    const personIds = participants?.map((p) => p.personId).sort();
    expect(personIds).toEqual([personAId, personBId].sort());
  });

  it("builds one contribution spec per person, each tagged with its own personId", async () => {
    const data = await fetchRetirementData(db, { contributionProfileId });
    const payload = await buildEnginePayload(db, data, {
      contributionProfileId,
    });

    const specPersonIds = payload.contributionSpecs
      .map((s) => s.personId)
      .sort();
    expect(specPersonIds).toEqual([personAId, personBId].sort());
  });

  it("aggregates starting balances across both people", async () => {
    const data = await fetchRetirementData(db, { contributionProfileId });
    const payload = await buildEnginePayload(db, data, {
      contributionProfileId,
    });

    expect(payload.portfolioTotal).toBe(650000);
  });
});

// ---------------------------------------------------------------------------
// R43 — irmaa_brackets is now wired into the engine payload.
// Before R43 the table + its Settings editor were live but no engine path
// read them; distributionTaxRates had no irmaaBrackets field, and
// decumulation-year.ts passed literal `undefined` to growIrmaaBrackets.
// These lock in that (a) the seeded rows now reach the payload, and
// (b) an admin edit to a row moves the resolved value.
// ---------------------------------------------------------------------------
describe("buildEnginePayload — irmaa_brackets wiring (R43)", () => {
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    db = ctx.db;
    cleanup = ctx.cleanup;
    const personId = await seedPerson(db, "Sam", "1980-01-10");
    await markPrimary(db, personId);
    await seedRetirementSettings(db, personId, { filingStatus: "Single" });
  });

  afterAll(() => cleanup());

  it("surfaces the seeded irmaa_brackets rows on distributionTaxRates", async () => {
    const data = await fetchRetirementData(db, {});
    const payload = await buildEnginePayload(db, data, {});
    const irmaa = payload!.distributionTaxRates.irmaaBrackets;
    expect(irmaa).toBeDefined();
    // Seed Single tier 1 threshold = 103000 (matches IRMAA_BRACKETS default).
    expect(irmaa!.Single?.[0]?.magiThreshold).toBe(103000);
  });

  it("an admin edit to an irmaa_brackets row moves the resolved value", async () => {
    const schema = await getSchema();
    const { and, eq } = await import("drizzle-orm");
    const latestYear = Math.max(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(
        (db as any)
          .select({ y: schema.irmaaBrackets.taxYear })
          .from(schema.irmaaBrackets)
          .all() as { y: number }[]
      ).map((r) => r.y),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any)
      .update(schema.irmaaBrackets)
      .set({
        brackets: [
          { magiThreshold: 999000, annualSurcharge: 4321 },
          { magiThreshold: 1000000, annualSurcharge: 5432 },
        ],
      })
      .where(
        and(
          eq(schema.irmaaBrackets.taxYear, latestYear),
          eq(schema.irmaaBrackets.filingStatus, "Single"),
        ),
      )
      .run();

    const data = await fetchRetirementData(db, {});
    const payload = await buildEnginePayload(db, data, {});
    const irmaa = payload!.distributionTaxRates.irmaaBrackets;
    expect(irmaa!.Single?.[0]?.magiThreshold).toBe(999000);
    expect(irmaa!.Single?.[0]?.annualSurcharge).toBe(4321);
  });
});
