/**
 * Answer key: contribution limits through the real routers
 * (`.scratch/docs/drafts/answer-key.md` § Limits, expected failures;
 * rulings in `reviews/2026-11-01/rebuild/limits-verdicts.md`). Invented
 * households on the seeded test database; every expected figure is worked
 * by hand from IRC 415(c), 414(v), 219 and Notice 2025-67, never read from
 * `src/`.
 *
 * Each case runs on 2026-04-14, inside the Jan 1–Apr 15 window for last
 * year's IRA and HSA money. Every limit reads the age at Dec 31 of its
 * tax year (IRC 219(b)(5)(B), 414(v)(5)); the AGE cases pin that.
 */
import "./setup-mocks";
import { afterAll, beforeAll, describe, it, vi } from "vitest";
import {
  createTestCaller,
  seedContributionAccount,
  seedContributionProfile,
  seedJob,
  seedPerson,
} from "./setup";
import { SK_ACTIVE_CONTRIB_PROFILE_ID } from "@/lib/constants/settings-keys";
import * as schema from "@/lib/db/schema-sqlite";
import { cents } from "../fixtures/answer-key";

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
  // leaves 72,000 − 60,000 = 12,000 of deferrals.
  const run = d2Household("1980-01-15");
  it("limits/D2-45 [LIM-07] employee 12,000, employer 60,000", async () => {
    const got = await run();
    cents(got.employee, 12_000);
    cents(got.employer, 60_000);
  });
});

describe("limits/D2-50: 415(c) dollar leg, 50+", () => {
  // Born 1974-01-15: 52. Deferrals past 415(c) can be catch-up at 50+
  // (Reg. 1.414(v)-1(b)(1)(i)), outside annual additions
  // (414(v)(3)(A)): 12,000 under 415(c) + 8,000 catch-up = 20,000, within
  // 402(g) + catch-up (32,500).
  const run = d2Household("1974-01-15");
  it("limits/D2-50 [LIM-07] employee 20,000, employer 60,000", async () => {
    const got = await run();
    cents(got.employee, 20_000);
    cents(got.employer, 60_000);
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
 * (Notice 2025-67 p.4) fits: the cap pass counts both jobs' pay.
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

  it("limits/IRA-2JOB [LIM-07] IRA kept 7,500 on 95,000 of compensation", async () => {
    cents(
      (await summaryFor(t, summaryProfileId, personId, "ira")).employeeContrib,
      7_500,
    );
  });

  // The same rule at save time: raising the IRA from 0 to 7,500 is
  // within the limit, so the save goes through.
  it("limits/IRA-2JOB:save [LIM-07] the 7,500 IRA saves", async () => {
    await t.caller.contributionProfile.setAccountActiveFields({
      profileId: activeProfileId,
      accountId: iraId,
      fields: { contributionValue: "7500", contributionMethod: "fixed_annual" },
    });
  });
});

// ---------------------------------------------------------------------------
// The age a limit reads: at Dec 31 of its tax year (IRC 219(b)(5)(B), 414(v)(5))
// ---------------------------------------------------------------------------

/** A traditional IRA of the person's own, 1,000 a year outside payroll
 *  (a job, so the person has a Contributions row). */
function iraHousehold(birthDate: string) {
  let t: TestCaller;
  let personId = 0;
  let profileId = 0;
  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    t = await createTestCaller();
    personId = await seedPerson(t.db, "Robin", birthDate);
    seedJob(t.db, personId, { annualSalary: "90000" });
    seedSingleFiler(t, personId);
    const accountId = seedContributionAccount(t.db, {
      personId,
      jobId: null,
      accountType: "ira",
      parentCategory: "Retirement",
      taxTreatment: "pre_tax",
    });
    profileId = seedContributionProfile(t.db, {
      name: "IRA",
      contributionActiveFields: {
        contributionAccounts: {
          [String(accountId)]: {
            contributionValue: "1000",
            contributionMethod: "fixed_annual",
          },
        },
      },
    });
    activate(t, profileId);
  });
  afterAll(() => {
    vi.useRealTimers();
    t.cleanup();
  });
  return async () => {
    const ira = await summaryFor(t, profileId, personId, "ira");
    return { limit: ira.limit, priorYearLimit: ira.priorYear?.limit ?? NaN };
  };
}

describe("last year's IRA room for someone 50 at last Dec 31", () => {
  // Born 1975-08-01; on 2026-04-14 (inside the Jan 1–Apr 15 window for
  // 2025 money) 50 today and 50 at Dec 31 2025, so 2025's catch-up
  // applies: 7,000 + 1,000 = 8,000 (IRC 219(b)(5)(B); Notice 2024-80).
  // 2026: 51 at Dec 31, 7,500 + 1,100 = 8,600 (Notice 2025-67).
  const run = iraHousehold("1975-08-01");
  it("limits/AGE-PY50 [LIM-05] 2025 room 8,000 (50 at Dec 31 2025)", async () => {
    cents(await run(), { limit: 8_600, priorYearLimit: 8_000 });
  });
});

describe("this year's IRA room for someone 50 by Dec 31", () => {
  // Born 1976-08-01: 49 on 2026-04-14 but 50 at Dec 31 2026, so 2026's
  // catch-up applies all year: 7,500 + 1,100 = 8,600 (Notice 2025-67).
  // 2025: 49 at Dec 31, 7,000 alone (Notice 2024-80).
  const run = iraHousehold("1976-08-01");
  it("limits/AGE-CY50 [LIM-05] 2026 room 8,600 all year (50 at Dec 31 2026)", async () => {
    cents(await run(), { limit: 8_600, priorYearLimit: 7_000 });
  });
});

// ---------------------------------------------------------------------------
// LM3: a save is judged on this tax year's checks too (402(g)(1) across employers)
// ---------------------------------------------------------------------------

/**
 * Single, born 1985-01-15 (41), on 2026-04-14. Job 1 paid monthly January 1 to March 31 with
 * 3,500 a check to a pre-tax 401(k): 3 × 3,500 = 10,500 already in. Job 2 from April 1, monthly
 * (9 checks this year). One 402(g) limit across both (Notice 2023-62 § III.B), 24,500 in 2026
 * (Notice 2025-67 p.1). Job 2's 401(k) at 24,000 a year fits a year's limit, but this year pays
 * 9/12 of it, 18,000: 10,500 + 18,000 = 28,500, over. At 18,000 a year: 13,500 + 10,500 =
 * 24,000, within.
 */
describe("limits/LM3-SAVE: a save over this year's limit is refused", () => {
  let t: TestCaller;
  let accountNow = 0;
  let profileId = 0;
  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    t = await createTestCaller();
    const personId = await seedPerson(t.db, "Robin", "1985-01-15");
    const monthly = { payPeriod: "monthly", payWeek: "na" } as const;
    const earlierJob = seedJob(t.db, personId, {
      ...monthly,
      employerName: "Earlier Co",
      startDate: "2026-01-01",
      endDate: "2026-03-31",
      annualSalary: "84000",
    });
    const jobNow = seedJob(t.db, personId, {
      ...monthly,
      employerName: "Now Co",
      startDate: "2026-04-01",
      annualSalary: "120000",
    });
    seedSingleFiler(t, personId);
    const k401 = (jobId: number) =>
      seedContributionAccount(t.db, {
        personId,
        jobId,
        accountType: "401k",
        taxTreatment: "pre_tax",
      });
    const accountEarlier = k401(earlierJob);
    accountNow = k401(jobNow);
    profileId = seedContributionProfile(t.db, {
      name: "Active",
      contributionActiveFields: {
        contributionAccounts: {
          [String(accountEarlier)]: {
            contributionValue: "3500",
            contributionMethod: "fixed_per_period",
          },
          [String(accountNow)]: {
            contributionValue: "0",
            contributionMethod: "fixed_annual",
          },
        },
      },
    });
    activate(t, profileId);
  });
  afterAll(() => {
    vi.useRealTimers();
    t.cleanup();
  });
  const save = (value: string) =>
    t.caller.contributionProfile.setAccountActiveFields({
      profileId,
      accountId: accountNow,
      fields: { contributionValue: value, contributionMethod: "fixed_annual" },
    });

  it("limits/LM3-SAVE [LIM-07] 24,000 a year at the job held now is refused", async () => {
    const refused = await save("24000").then(
      () => 0,
      () => 1,
    );
    cents(refused, 1);
  });

  it("limits/LM3-SAVE-ok [LIM-07] 18,000 a year saves", async () => {
    await save("18000");
  });
});
