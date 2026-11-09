/**
 * Live contributions for a job that ended after its last posted
 * contribution. Invented household: Dana earns $90,000 and is matched 50%
 * of up to 6% in her 401(k); the feed's last contribution posted Sep 30,
 * the job ended Oct 15, and the request is on Nov 8. The months through
 * the last posted day are judged with the job held on that day, the IRS
 * limits' cap included.
 */
import "../../../routers/setup-mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import {
  createTestCaller,
  seedPerson,
  seedJob,
  seedPerformanceAccount,
  seedContributionProfile,
} from "../../../routers/setup";
import { SK_ACTIVE_CONTRIB_PROFILE_ID } from "@/lib/constants/settings-keys";
import { loadContributionMix } from "@/server/services/contributions/contribution-mix";
import {
  loadLiveContributions,
  toPaceInput,
} from "@/server/services/investments/live-contributions";

const REQUEST = new Date(2026, 10, 8, 12);
const LAST_POSTED = new Date("2026-09-30T12:00:00Z");

/** Dana's household with her 401(k) at `percent` of pay, and four
 *  biweekly contributions of `perCheck` posted through Sep 30. */
async function seedDana(percent: string, perCheck: string) {
  const ctx = await createTestCaller();
  const { db } = ctx;
  const dana = await seedPerson(db, "Dana", "1985-04-01");
  const jobId = seedJob(db, dana, {
    annualSalary: "90000",
    startDate: "2020-01-06",
    endDate: "2026-10-15",
  });
  const perfId = seedPerformanceAccount(db, {
    ownerPersonId: dana,
    institution: "Example Bank",
    accountType: "401k",
    accountLabel: "401(k)",
  });
  const accountId = db
    .insert(sqliteSchema.contributionAccounts)
    .values({
      personId: dana,
      jobId,
      accountType: "401k",
      parentCategory: "Retirement",
      taxTreatment: "pre_tax",
      employerMatchType: "percent_of_contribution",
      employerMatchValue: "50",
      employerMatchRate: "0.5",
      employerMaxMatchPct: "0.06",
      isActive: true,
      performanceAccountId: perfId,
    })
    .returning({ id: sqliteSchema.contributionAccounts.id })
    .get().id;
  const profileId = seedContributionProfile(db, {
    name: "Dana's setup",
    contributionActiveFields: {
      contributionAccounts: {
        [String(accountId)]: {
          contributionMethod: "percent_of_salary",
          contributionValue: percent,
        },
      },
      deductions: {},
    },
  });
  db.insert(sqliteSchema.appSettings)
    .values({ key: SK_ACTIVE_CONTRIB_PROFILE_ID, value: profileId })
    .onConflictDoUpdate({
      target: sqliteSchema.appSettings.key,
      set: { value: profileId },
    })
    .run();
  db.insert(sqliteSchema.accountPerformance)
    .values({
      year: 2026,
      institution: "Example Bank",
      accountLabel: "401(k)",
      ownerPersonId: dana,
      beginningBalance: "50000",
      totalContributions: "0",
      employerContributions: "0",
      yearlyGainLoss: "0",
      endingBalance: "50000",
      parentCategory: "Retirement",
      performanceAccountId: perfId,
    })
    .run();
  const feed = db
    .insert(sqliteSchema.simplefinAccounts)
    .values({
      externalAccountId: "dana-401k",
      orgName: "Example Bank",
      accountName: "401(k)",
      lastBalance: "58000",
      linkedPerformanceAccountId: perfId,
    })
    .returning()
    .get().id;
  const days = ["2026-08-21", "2026-09-04", "2026-09-18", "2026-09-30"];
  for (const [i, posted] of days.entries())
    db.insert(sqliteSchema.investmentTransactions)
      .values({
        simplefinAccountId: feed,
        externalId: `c${i}`,
        posted,
        amount: perCheck,
        description: "CONTRIBUTION",
        pending: false,
      })
      .run();
  return { ctx, perfId };
}

/** Every figure the live-contributions path gives Dana's account. */
async function figures(seeded: Awaited<ReturnType<typeof seedDana>>) {
  const { ctx, perfId } = seeded;
  const then = (await loadContributionMix(ctx.db as never, LAST_POSTED)).get(
    perfId,
  )!;
  const live = (await loadLiveContributions(ctx.db as never, REQUEST)).find(
    (c) => c.performanceAccountId === perfId,
  )!;
  const savings = await ctx.caller.investments.computeSavingsThisYear();
  return { then, live, pace: toPaceInput(live), savings };
}

// The figures, as v0.10.5 gives them. At 6% no limit binds and v0.10.4
// gave the same; at 30% v0.10.4 judged the cap with no job (the request's
// date, after Oct 15) and left $27,000 uncapped: $10,280.77 on its way and
// $14,434.61 by year end (owner N5: the posted day's job is kept).
describe.each([
  {
    percent: "6",
    perCheck: "207.69",
    employee: 5400,
    remaining: 2803.85,
    perContribution: 311.54,
    pending: 830.76,
    yearEnd: 3634.61,
  },
  {
    percent: "30",
    perCheck: "1038.46",
    employee: 24500,
    remaining: 9415.38,
    perContribution: 1046.15,
    pending: 4153.84,
    yearEnd: 13569.22,
  },
])("Dana at $percent% of pay", (expected) => {
  let seeded: Awaited<ReturnType<typeof seedDana>>;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: REQUEST });
    seeded = await seedDana(expected.percent, expected.perCheck);
  }, 60_000);

  afterAll(() => {
    seeded.ctx.cleanup();
    vi.useRealTimers();
  });

  it("judges the months through the last posted day with the job held then", async () => {
    const { then, live, pace, savings } = await figures(seeded);
    // The setup on Sep 30: capped at the $24,500 employee limit when over
    // it; the match is 50% of up to 6% of $90,000.
    expect(then.employeePreTax).toBeCloseTo(expected.employee, 2);
    expect(then.employer).toBeCloseTo(2700, 2);
    expect(then.remainingThisYear).toBeCloseTo(expected.remaining, 2);
    expect(then.perContribution).toBeCloseTo(expected.perContribution, 2);
    expect(live).toMatchObject({
      recorded: { employee: 0, employer: 0 },
      pending: { employee: expected.pending, employer: 0 },
      unposted: { employee: expected.remaining, employer: 0 },
      latestContributionDay: "2026-09-30",
      plan: { yearly: 0, remaining: 0 },
    });
    expect(pace).toMatchObject({
      pending: expected.pending,
      unposted: expected.remaining,
    });
    expect(savings.accounts[0]).toMatchObject({
      saved: expected.pending,
      unposted: expected.remaining,
      yearEnd: expected.yearEnd,
      status: "no_plan",
    });
  });
});
