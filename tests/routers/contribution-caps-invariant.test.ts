/**
 * The cross-consumer invariant for IRS-limit caps: one person configured
 * over their 401(k) limit, and every figure that reads this year's
 * contribution — the contribution summary, the paycheck (per check and
 * pre-tax income), the engine payload (year-0 amounts and specs) and the
 * contribution mix — shows the same capped amount. A grep can't see
 * `perPeriod × periods`; this can. The pay-stub check alone keeps the
 * configured amount (what payroll actually deducts).
 *
 * 2026-04-14, born 1990 (36 at Dec 31): the 401(k) limit is 24,500.
 * 30% of 120,000 = 36,000 configured → 24,500 capped.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  createTestCaller,
  seedStandardDataset,
  seedContributionProfile,
} from "./setup";
import {
  buildEnginePayload,
  fetchRetirementData,
} from "@/server/retirement/build-engine-payload";
import { loadContributionMix } from "@/server/helpers/contribution-mix";
import { SK_ACTIVE_CONTRIB_PROFILE_ID } from "@/lib/constants/settings-keys";
import * as schema from "@/lib/db/schema-sqlite";
import type { Db } from "@/server/helpers/transforms";

const FIXED_NOW = new Date("2026-04-14T12:00:00Z");
const LIMIT = 24500;
const CONFIGURED = 36000;

describe("IRS-limit caps — every consumer shows the capped amount", () => {
  let t: Awaited<ReturnType<typeof createTestCaller>>;
  let personId: number;
  let perfAcctId: number;
  let profileId: number;

  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    t = await createTestCaller();
    const seeded = seedStandardDataset(t.db);
    personId = seeded.personId;
    perfAcctId = seeded.perfAcctId;
    const acct = t.db
      .insert(schema.contributionAccounts)
      .values({
        personId,
        jobId: seeded.jobId,
        accountType: "401k",
        parentCategory: "Retirement",
        taxTreatment: "pre_tax",
        employerMatchType: "none",
        isActive: true,
        ownership: "individual",
        performanceAccountId: perfAcctId,
      })
      .returning({ id: schema.contributionAccounts.id })
      .get();
    profileId = seedContributionProfile(t.db, {
      name: "Over the limit",
      contributionActiveFields: {
        contributionAccounts: {
          [String(acct.id)]: {
            contributionValue: "30",
            contributionMethod: "percent_of_salary",
          },
        },
        jobs: {},
      },
    });
    t.db.$client.exec(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('${SK_ACTIVE_CONTRIB_PROFILE_ID}', '${profileId}')`,
    );
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
        socialSecurityMonthly: "2500",
        ssStartAge: 67,
        raisesDuringRetirement: false,
        enableRothConversions: false,
        withdrawalStrategy: "fixed",
        gkSkipInflationAfterLoss: true,
        filingStatus: "MFJ",
      })
      .run();
  });

  afterAll(() => {
    vi.useRealTimers();
    t.cleanup();
  });

  it("the contribution summary", async () => {
    const result = await t.caller.contribution.computeSummary({
      contributionProfileId: profileId,
    });
    const person = result.people.find((p) => p.person.id === personId)!;
    const k = person.accountTypes.find((a) => a.categoryKey === "401k")!;
    expect(k.employeeContrib).toBeCloseTo(LIMIT, 2);
  });

  it("the paycheck: per check × checks, pre-tax income — and the pay-stub check keeps the configured amount", async () => {
    const result = await t.caller.paycheck.computeSummary({
      contributionProfileId: profileId,
    });
    const person = result.people.find((p) => p.person.id === personId)!;
    const pc = person.paycheck!;
    const perCheck401k = pc.preTaxDeductions
      .filter((d) => d.name.toLowerCase().includes("401"))
      .reduce((s, d) => s + d.amount, 0);
    expect(perCheck401k * pc.periodsPerYear).toBeCloseTo(LIMIT, 0);

    const stub = person.paystubPaycheck!;
    const stub401k = stub.preTaxDeductions
      .filter((d) => d.name.toLowerCase().includes("401"))
      .reduce((s, d) => s + d.amount, 0);
    expect(stub401k * stub.periodsPerYear).toBeCloseTo(CONFIGURED, 0);
  });

  it("the engine payload: year-0 amount and the spec", async () => {
    const data = await fetchRetirementData(t.db, {
      contributionProfileId: profileId,
    });
    const payload = (await buildEnginePayload(t.db, data, {
      contributionProfileId: profileId,
    }))!;
    expect(payload.baseEngineInput.baseYearContributions!["401k"]).toBeCloseTo(
      LIMIT,
      2,
    );
    const spec = payload.contributionSpecs.find((s) => s.category === "401k")!;
    expect(spec.baseAnnual).toBeCloseTo(LIMIT, 2);
    expect(spec.configuredAnnual).toBeCloseTo(CONFIGURED, 2);
  });

  it("the contribution mix", async () => {
    const mix = (
      await loadContributionMix(
        // eslint-disable-next-line no-restricted-syntax -- the test SQLite db stands in for the app Db type (Drizzle dialect cast)
        t.db as unknown as Db,
        FIXED_NOW,
      )
    ).get(perfAcctId)!;
    expect(mix.employeePreTax).toBeCloseTo(LIMIT, 2);
  });
});
