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
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
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
// irmaa_brackets is now wired into the engine payload.
// The table + its Settings editor were previously live but no engine path
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic schema import requires runtime cast
    const rawDb = db as any;
    const years = (
      rawDb
        .select({ y: schema.irmaaBrackets.taxYear })
        .from(schema.irmaaBrackets)
        .all() as { y: number }[]
    ).map((r) => r.y);
    const latestYear = Math.max(...years);
    rawDb
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

// ---------------------------------------------------------------------------
// retirement_profiles.tax_params_year pins the resolved year.
// NULL (default) => newest enacted, byte-identical to before this field
// existed. A non-null value re-prices the projection under that year's
// reference data.
// ---------------------------------------------------------------------------
describe("buildEnginePayload — tax_params_year profile pin (R43)", () => {
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let profileId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    db = ctx.db;
    cleanup = ctx.cleanup;
    const schema = await getSchema();
    const personId = await seedPerson(db, "Jo", "1975-03-03");
    await markPrimary(db, personId);
    await seedRetirementSettings(db, personId, { filingStatus: "MFJ" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileId = (db as any)
      .insert(schema.retirementProfiles)
      .values({ name: "Current Plan" })
      .returning({ id: schema.retirementProfiles.id })
      .get().id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).update(schema.retirementSettings).set({ profileId }).run();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any)
      .insert(schema.retirementProfilePeople)
      .values({ profileId, personId, retirementAge: 65, endAge: 95 })
      .run();
  });

  afterAll(() => cleanup());

  it("NULL pin => resolved year is the newest seeded year (2026)", async () => {
    const data = await fetchRetirementData(db, {});
    const payload = await buildEnginePayload(db, data, {});
    expect(payload!.distributionTaxRates.taxDataYear).toBe(2026);
    expect(payload!.distributionTaxRates.standardDeduction).toBe(32200);
  });

  it("pinning the active profile to 2025 re-prices under 2025 data", async () => {
    const schema = await getSchema();
    const { eq } = await import("drizzle-orm");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any)
      .update(schema.retirementProfiles)
      .set({ taxParamsYear: 2025 })
      .where(eq(schema.retirementProfiles.id, profileId))
      .run();

    const data = await fetchRetirementData(db, {});
    const payload = await buildEnginePayload(db, data, {});
    expect(payload!.distributionTaxRates.taxDataYear).toBe(2025);
    // 2025 MFJ standard deduction is 30000 (seed); 2026 is 32200.
    expect(payload!.distributionTaxRates.standardDeduction).toBe(30000);
  });

  // resolveTaxParams's candidateYears() is
  // sourced from contribution_limits ALONE (not the union of all five
  // reference tables) specifically so a year like this — tax_brackets
  // seeded, contribution_limits not — is never selectable at all, pinned
  // or not. Pinning taxParamsYear to 2030 here degrades via "nearest" to
  // the newest year that DOES have complete data (2026), never throws.
  // requireLimit() still throws for a genuinely incomplete resolved year
  // (see the contribution-limits-completeness coverage in
  // tests/config/tax-params.test.ts) — that's the case this test used to
  // exercise before the fix, but candidateYears() now makes that case
  // unreachable through normal resolution, closing the outage vector
  // where an admin seeding one table early could 500 every household's
  // projections.
  it("pinning a year with brackets but no contribution_limits row degrades to nearest, never throws (F2-4 hard case)", async () => {
    const schema = await getSchema();
    const { eq } = await import("drizzle-orm");
    // A year with tax_brackets seeded but deliberately NO
    // contribution_limits row — the drift-window scenario, taken to its
    // extreme (zero limits rows for the resolved year, not just a partial
    // set).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any)
      .insert(schema.taxBrackets)
      .values({
        taxYear: 2030,
        filingStatus: "MFJ",
        w4Checkbox: false,
        brackets: [{ threshold: 0, baseWithholding: 0, rate: 0.1 }],
      })
      .run();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any)
      .update(schema.retirementProfiles)
      .set({ taxParamsYear: 2030 })
      .where(eq(schema.retirementProfiles.id, profileId))
      .run();

    const data = await fetchRetirementData(db, {});
    const payload = await buildEnginePayload(db, data, {});
    expect(payload!.distributionTaxRates.taxDataYear).toBe(2026);
    expect(payload!.distributionTaxRates.standardDeduction).toBe(32200);

    // Clean up so later tests in this describe block aren't affected by
    // vitest's shared beforeAll DB (none currently follow, but be defensive).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any)
      .update(schema.retirementProfiles)
      .set({ taxParamsYear: null })
      .where(eq(schema.retirementProfiles.id, profileId))
      .run();
  });
});

// Step 5 of SOCIAL-SECURITY-OPTIMIZATION-PLAN.md: socialSecurityPia is
// opt-in (decision #5). A single-person household with PIA set routes
// through the SCALAR socialSecurityAnnual field, NOT socialSecurityEntries
// — an earlier version of this diff populated entries for single-person
// households too, which an advisor review caught: socialSecurityEntries is
// also the engine's ONLY source for per-person RMD tracking
// (rmdStartAgeByPerson in projection-year-handlers/context.ts), so
// populating it for a single-person household silently changes RMD
// behavior (and net worth) as a side effect of an SS-only feature. See the
// long comment on socialSecurityEntries in build-engine-payload.ts.
describe("buildEnginePayload — socialSecurityPia (opt-in, step 5)", () => {
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let personId: number;
  let profileId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    db = ctx.db;
    cleanup = ctx.cleanup;
    const schema = await getSchema();

    // Born 1963 -> FRA 67y0m (1960+ band), matching
    // tests/calculators/social-security.test.ts's own fixture so the
    // expected multiplier is the same well-known value.
    personId = await seedPerson(db, "Pat", "1963-04-10");
    await markPrimary(db, personId);
    await seedRetirementSettings(db, personId, {
      socialSecurityMonthly: "3000",
      ssStartAge: 62, // 60 months early at FRA 67 -> 0.70 multiplier
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileId = (db as any)
      .insert(schema.retirementProfiles)
      .values({ name: "Current Plan" })
      .returning({ id: schema.retirementProfiles.id })
      .get().id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).update(schema.retirementSettings).set({ profileId }).run();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any)
      .insert(schema.retirementProfilePeople)
      .values({
        profileId,
        personId,
        retirementAge: 65,
        endAge: 95,
        socialSecurityMonthly: "3000",
        ssStartAge: 62,
        // No socialSecurityPia yet — set per-test below where needed.
      })
      .run();
  });

  afterAll(() => cleanup());

  // Reset both rows to their known-clean baseline after every test,
  // regardless of pass/fail — a test that seeds a divergent ssStartAge (or
  // fails partway through) must never leak state into the next test in
  // this block.
  afterEach(async () => {
    const schema = await getSchema();
    const { eq } = await import("drizzle-orm");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any)
      .update(schema.retirementProfilePeople)
      .set({ ssStartAge: 62, socialSecurityPia: null })
      .where(eq(schema.retirementProfilePeople.personId, personId))
      .run();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any)
      .update(schema.retirementSettings)
      .set({ ssStartAge: 62 })
      .where(eq(schema.retirementSettings.personId, personId))
      .run();
  });

  async function setPia(value: string | null) {
    const schema = await getSchema();
    const { eq } = await import("drizzle-orm");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any)
      .update(schema.retirementProfilePeople)
      .set({ socialSecurityPia: value })
      .where(eq(schema.retirementProfilePeople.personId, personId))
      .run();
  }

  it("without PIA set, a single-person household stays on the scalar path (no socialSecurityEntries)", async () => {
    const data = await fetchRetirementData(db, {});
    const payload = await buildEnginePayload(db, data, {});

    expect(payload!.baseEngineInput.socialSecurityEntries).toBeUndefined();
    expect(payload!.baseEngineInput.socialSecurityAnnual).toBe(36000);
    expect(payload!.baseEngineInput.ssStartAge).toBe(62);
  });

  it("with PIA set, a single-person household stays on the scalar path with the claiming-age-adjusted amount — socialSecurityEntries is still undefined", async () => {
    await setPia("4000"); // PIA $4000/mo = $48000/yr at FRA

    const data = await fetchRetirementData(db, {});
    const payload = await buildEnginePayload(db, data, {});

    // The load-bearing regression check: entries must NOT be populated for
    // a single-person household just because PIA is set — that's exactly
    // the bug the advisor review caught.
    expect(payload!.baseEngineInput.socialSecurityEntries).toBeUndefined();
    // FRA 67, claiming at 62 (60 months early) -> 0.70 multiplier (SSA's
    // own published table, same golden value tests/config/
    // social-security.test.ts checks against directly).
    expect(payload!.baseEngineInput.socialSecurityAnnual).toBeCloseTo(
      48000 * 0.7,
      2,
    );
    expect(payload!.baseEngineInput.ssStartAge).toBe(62);

    await setPia(null);
  });

  it("an empty-string PIA (blank form field) is treated as not-opted-in, not NaN", async () => {
    await setPia("");

    const data = await fetchRetirementData(db, {});
    const payload = await buildEnginePayload(db, data, {});

    expect(payload!.baseEngineInput.socialSecurityAnnual).toBe(36000);
    expect(Number.isNaN(payload!.baseEngineInput.socialSecurityAnnual)).toBe(
      false,
    );

    await setPia(null);
  });

  it('a "0" PIA is treated as not-opted-in, not a $0 benefit', async () => {
    await setPia("0");

    const data = await fetchRetirementData(db, {});
    const payload = await buildEnginePayload(db, data, {});

    // Falls back to the flat socialSecurityMonthly (36000), NOT 0.
    expect(payload!.baseEngineInput.socialSecurityAnnual).toBe(36000);

    await setPia(null);
  });

  // Permanent regression test for a bug an advisor review caught: an
  // earlier version of this fix computed the PIA-adjusted amount using
  // retirement_profile_people.ss_start_age (the live value the "SS Start
  // Age" UI control actually writes — upsertHouseholdFields writes ONLY
  // that table) but emitted the separate, staler retirement_settings.ss_
  // start_age as the projection's actual ssStartAge — so the engine could
  // pay a benefit adjusted for one claiming age starting at a different
  // one. This test deliberately seeds the two tables with DIFFERENT
  // ss_start_age values (the earlier tests in this block seed them
  // identically, which is exactly what let the bug through unnoticed).
  it("uses retirement_profile_people's ssStartAge for BOTH the PIA adjustment and the emitted ssStartAge, not a stale retirement_settings value", async () => {
    const schema = await getSchema();
    const { eq } = await import("drizzle-orm");
    // Simulate a household whose retirement_settings row is stale (never
    // updated after the profile-people table became the live source) —
    // retirement_settings still says 67, but retirement_profile_people
    // (what the UI actually edited) says 70.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any)
      .update(schema.retirementSettings)
      .set({ ssStartAge: 67 })
      .where(eq(schema.retirementSettings.personId, personId))
      .run();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any)
      .update(schema.retirementProfilePeople)
      .set({ ssStartAge: 70, socialSecurityPia: "4000" })
      .where(eq(schema.retirementProfilePeople.personId, personId))
      .run();

    const data = await fetchRetirementData(db, {});
    const payload = await buildEnginePayload(db, data, {});

    // The emitted ssStartAge must be 70 (the live, per-person value) —
    // NOT 67 (the stale retirement_settings value) — and the amount must
    // be adjusted for claiming at 70 (delayed credits), not for 67.
    expect(payload!.baseEngineInput.ssStartAge).toBe(70);
    // FRA 67, claiming at 70 (36 months delayed) -> 1.24 multiplier (SSA's
    // own published table).
    expect(payload!.baseEngineInput.socialSecurityAnnual).toBeCloseTo(
      48000 * 1.24,
      2,
    );
    // afterEach resets both tables' ssStartAge to 62 and clears PIA.
  });
});

describe("buildEnginePayload — socialSecurityPia, two-person household", () => {
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let personAId: number;
  let personBId: number;
  let profileId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    db = ctx.db;
    cleanup = ctx.cleanup;
    const schema = await getSchema();

    personAId = await seedPerson(db, "Alex", "1963-04-10"); // FRA 67
    personBId = await seedPerson(db, "Sam", "1965-09-20"); // FRA 67
    await markPrimary(db, personAId);
    await seedRetirementSettings(db, personAId, {
      socialSecurityMonthly: "3000",
    });
    await seedRetirementSettings(db, personBId, {
      socialSecurityMonthly: "1800",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileId = (db as any)
      .insert(schema.retirementProfiles)
      .values({ name: "Current Plan" })
      .returning({ id: schema.retirementProfiles.id })
      .get().id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).update(schema.retirementSettings).set({ profileId }).run();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any)
      .insert(schema.retirementProfilePeople)
      .values([
        {
          profileId,
          personId: personAId,
          retirementAge: 65,
          endAge: 95,
          socialSecurityMonthly: "3000",
          ssStartAge: 62, // 60 months early at FRA 67 -> 0.70
          socialSecurityPia: "4000", // opted in
        },
        {
          profileId,
          personId: personBId,
          retirementAge: 65,
          endAge: 95,
          socialSecurityMonthly: "1800",
          ssStartAge: 67, // exactly at FRA -> 1.0, no PIA set
        },
      ])
      .run();
  });

  afterAll(() => cleanup());

  it("multi-person households already populated entries before this feature — that's unaffected by PIA either way", async () => {
    const data = await fetchRetirementData(db, {});
    const payload = await buildEnginePayload(db, data, {});

    const entries = payload!.baseEngineInput.socialSecurityEntries;
    expect(entries).toHaveLength(2);
  });

  it("only the person with PIA set gets the claiming-age-adjusted amount; the other keeps their flat monthly amount", async () => {
    const data = await fetchRetirementData(db, {});
    const payload = await buildEnginePayload(db, data, {});

    const entries = payload!.baseEngineInput.socialSecurityEntries!;
    const alex = entries.find((e) => e.personId === personAId)!;
    const sam = entries.find((e) => e.personId === personBId)!;

    // Alex: PIA $4000/mo = $48000/yr, claiming at 62 (60mo early, FRA 67) -> 0.70
    expect(alex.annualAmount).toBeCloseTo(48000 * 0.7, 2);
    // Sam: no PIA set -> unchanged flat monthly amount ($1800/mo = $21600/yr)
    expect(sam.annualAmount).toBe(21600);
  });
});
