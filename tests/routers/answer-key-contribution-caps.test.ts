/**
 * Answer key: contribution limits through the real routers
 * (`.scratch/docs/drafts/answer-key.md` § Limits, expected failures;
 * rulings in `reviews/2026-11-01/rebuild/limits-verdicts.md`). Invented
 * households on the seeded test database; every expected figure is worked
 * by hand from IRC 415(c), 414(v), 219 and Notice 2025-67, never read from
 * `src/`.
 *
 * Each case runs on 2026-04-14, a person born in January, so today's age
 * and the Dec 31 age agree (the router reads today's age in places,
 * v0.11 Limits "Catch-up limits on Paycheck/Contributions use today's age").
 */
import "./setup-mocks";
import { afterAll, beforeAll, describe, vi } from "vitest";
import {
  createTestCaller,
  seedContributionAccount,
  seedContributionProfile,
  seedJob,
  seedPerson,
} from "./setup";
import { SK_ACTIVE_CONTRIB_PROFILE_ID } from "@/lib/constants/settings-keys";
import * as schema from "@/lib/db/schema-sqlite";
import { xfail } from "../fixtures/answer-key";

const FIXED_NOW = new Date("2026-04-14T12:00:00Z");

type TestCaller = Awaited<ReturnType<typeof createTestCaller>>;

/** Single filer: the household's filing status for this year's caps. */
function seedSingleFiler(t: TestCaller, personId: number) {
  t.db
    .insert(schema.retirementSettings)
    .values({
      personId,
      retirementAge: 65,
      endAge: 95,
      returnAfterRetirement: "0.06",
      annualInflation: "0.03",
      salaryAnnualIncrease: "0.03",
      withdrawalRate: "0.04",
      taxMultiplier: "1.0",
      grossUpForTaxes: true,
      socialSecurityMonthly: "0",
      ssStartAge: 67,
      raisesDuringRetirement: false,
      enableRothConversions: false,
      withdrawalStrategy: "fixed",
      gkSkipInflationAfterLoss: true,
      filingStatus: "Single",
    })
    .run();
}

/** Make `profileId` the active Contribution Profile. */
function activate(t: TestCaller, profileId: number) {
  t.sqlite.exec(
    `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('${SK_ACTIVE_CONTRIB_PROFILE_ID}', '${profileId}')`,
  );
}

/** One type's figures on the Contributions summary for the person. */
async function summaryFor(
  t: TestCaller,
  profileId: number,
  personId: number,
  categoryKey: string,
) {
  const result = await t.caller.contribution.computeSummary({
    contributionProfileId: profileId,
  });
  const person = result.people.find((p) => p.person.id === personId)!;
  return person.accountTypes.find((a) => a.categoryKey === categoryKey)!;
}

// ---------------------------------------------------------------------------
// D2: the 415(c) dollar leg (verdict D2; IRC 415(c)(1)(A))
// ---------------------------------------------------------------------------

/**
 * Pay 200,000; a 401(k) of 24,500 a year with 60,000 a year of employer
 * money (fixed annual). Annual additions = employer money + deferrals
 * (415(c)(2)), held to min(72,000, 200,000) = 72,000 (Notice 2025-67 p.1).
 */
function d2Household(birthDate: string) {
  let t: TestCaller;
  let personId = 0;
  let profileId = 0;
  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    t = await createTestCaller();
    personId = await seedPerson(t.db, "Dana", birthDate);
    const jobId = seedJob(t.db, personId, { annualSalary: "200000" });
    seedSingleFiler(t, personId);
    const accountId = seedContributionAccount(t.db, {
      personId,
      jobId,
      accountType: "401k",
      employerMatchType: "fixed_annual",
      employerMatchValue: "60000",
    });
    profileId = seedContributionProfile(t.db, {
      name: "D2",
      contributionActiveFields: {
        contributionAccounts: {
          [String(accountId)]: {
            contributionValue: "24500",
            contributionMethod: "fixed_annual",
          },
        },
        jobs: {},
      },
    });
    activate(t, profileId);
  });
  afterAll(() => {
    vi.useRealTimers();
    t.cleanup();
  });
  return async () => {
    const k = await summaryFor(t, profileId, personId, "401k");
    return { employee: k.employeeContrib, employer: k.employerMatch };
  };
}

describe("limits/D2-45: 415(c) dollar leg, under 50", () => {
  // Born 1980-01-15: 46 today and at Dec 31 2026. All deferrals count as
  // annual additions under 50 (Reg. 1.414(v)-1(a)(1)): employer 60,000
  // leaves 72,000 − 60,000 = 12,000 of deferrals. Today Ledgr keeps 24,500
  // and 60,000 (84,500 in all) and allows the save (verdict D2 repro).
  const run = d2Household("1980-01-15");
  xfail({
    id: "limits/D2-45 [LIM-07]",
    todo: 'v0.11 Limits "Annual-additions step per employer" (verdict D2)',
    run,
    expected: { employee: 12_000, employer: 60_000 },
    today: { employee: 24_500, employer: 60_000 },
  });
});

describe("limits/D2-50: 415(c) dollar leg, 50+", () => {
  // Born 1974-01-15: 52. Deferrals past 415(c) can be catch-up at 50+
  // (Reg. 1.414(v)-1(b)(1)(i)), outside annual additions
  // (414(v)(3)(A)): 12,000 under 415(c) + 8,000 catch-up = 20,000, within
  // 402(g) + catch-up (32,500). Today the same 24,500 + 60,000.
  const run = d2Household("1974-01-15");
  xfail({
    id: "limits/D2-50 [LIM-07]",
    todo: 'v0.11 Limits "Annual-additions step per employer" (verdict D2)',
    run,
    expected: { employee: 20_000, employer: 60_000 },
    today: { employee: 24_500, employer: 60_000 },
  });
});

// ---------------------------------------------------------------------------
// IRA-2JOB: every current job counts toward IRA pay (IRC 219(f)(1))
// ---------------------------------------------------------------------------

/**
 * Single, born 1985-01-15 (41). Two current jobs: 5,000 a year (the first
 * on file) and 100,000 a year, with 10,000 a year pre-tax to a 401(k) at
 * the second. Taxable compensation (W-2 box 1) = 5,000 + 100,000 − 10,000
 * = 95,000 (219(f)(1); Pub 590-A Table 1-1), so the whole 7,500 IRA limit
 * (Notice 2025-67 p.4) fits. Today the cap pass sees one job per person,
 * the 5,000 one, takes the other job's 401(k) off it anyway and finds
 * compensation 0: the IRA is cut to 0 and a save is refused with "set it
 * to 0" (verdict "New: concurrent jobs"; the Paycheck gross is 192.31).
 */
describe("limits/IRA-2JOB: all current jobs count toward pay", () => {
  let t: TestCaller;
  let personId = 0;
  let iraId = 0;
  let summaryProfileId = 0;
  let activeProfileId = 0;
  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    t = await createTestCaller();
    personId = await seedPerson(t.db, "Robin", "1985-01-15");
    seedJob(t.db, personId, {
      employerName: "Side Co",
      startDate: "2020-01-01",
      annualSalary: "5000",
    });
    const mainJobId = seedJob(t.db, personId, {
      employerName: "Main Co",
      startDate: "2024-01-01",
      annualSalary: "100000",
    });
    seedSingleFiler(t, personId);
    const k401 = seedContributionAccount(t.db, {
      personId,
      jobId: mainJobId,
      accountType: "401k",
      taxTreatment: "pre_tax",
    });
    iraId = seedContributionAccount(t.db, {
      personId,
      jobId: null,
      accountType: "ira",
      taxTreatment: "tax_free",
    });
    const fields = (ira: string) => ({
      contributionAccounts: {
        [String(k401)]: {
          contributionValue: "10000",
          contributionMethod: "fixed_annual",
        },
        [String(iraId)]: {
          contributionValue: ira,
          contributionMethod: "fixed_annual",
        },
      },
      jobs: {},
    });
    // The summary reads a profile with the IRA at 7,500; the save is
    // judged on the active profile, where the IRA starts at 0.
    summaryProfileId = seedContributionProfile(t.db, {
      name: "IRA at 7,500",
      contributionActiveFields: fields("7500"),
    });
    activeProfileId = seedContributionProfile(t.db, {
      name: "Active",
      contributionActiveFields: fields("0"),
    });
    activate(t, activeProfileId);
  });
  afterAll(() => {
    vi.useRealTimers();
    t.cleanup();
  });

  xfail({
    id: "limits/IRA-2JOB [LIM-07]",
    todo: 'v0.11 Limits "All current jobs count in the cap pass and Paycheck"',
    run: async () =>
      (await summaryFor(t, summaryProfileId, personId, "ira")).employeeContrib,
    expected: 7_500,
    today: 0,
  });

  // The same rule at save time: raising the IRA from 0 to 7,500 is
  // within the limit (1 = refused, 0 = saved).
  xfail({
    id: "limits/IRA-2JOB:save [LIM-07]",
    todo: 'v0.11 Limits "All current jobs count in the cap pass and Paycheck"',
    run: () =>
      t.caller.contributionProfile
        .setAccountActiveFields({
          profileId: activeProfileId,
          accountId: iraId,
          fields: {
            contributionValue: "7500",
            contributionMethod: "fixed_annual",
          },
        })
        .then(
          () => 0,
          (e: Error) => (/set it to 0/.test(e.message) ? 1 : -1),
        ),
    expected: 0,
    today: 1,
  });
});
