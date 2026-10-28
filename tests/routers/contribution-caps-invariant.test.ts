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
import { applyContributionAccountEdit } from "@/server/helpers/contribution";
import { assertWithinIrsLimits } from "@/server/helpers/contribution-caps";
import { eq } from "drizzle-orm";
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
  let accountId: number;
  let jobId: number;

  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    t = await createTestCaller();
    const seeded = seedStandardDataset(t.db);
    personId = seeded.personId;
    perfAcctId = seeded.perfAcctId;
    jobId = seeded.jobId;
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
    accountId = acct.id;
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

  it("the engine payload: the active profile capped at each later year's ages", async () => {
    const data = await fetchRetirementData(t.db, {
      contributionProfileId: profileId,
    });
    const payload = (await buildEnginePayload(t.db, data, {
      contributionProfileId: profileId,
    }))!;
    // 36,000 configured: 24,500 now; catch-up from 50 (2040), the larger
    // one at 60–63 (2050), the smaller again at 64 (2054, the last
    // working year before retiring at 65).
    expect(
      payload.baseEngineInput.profileSwitches!.map((s) => [
        s.year,
        Math.round(s.baseYearContributions["401k"]),
      ]),
    ).toEqual([
      [2040, 32500],
      [2050, 35750],
      [2054, 32500],
    ]);
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

  describe("over the limit is an error to fix: saving one is refused", () => {
    const setValue = (contributionValue: string) =>
      t.caller.contributionProfile.setAccountActiveFields({
        profileId,
        accountId,
        fields: { contributionValue, contributionMethod: "percent_of_salary" },
      });

    it("lowering an over-limit contribution saves, even while it's still over", async () => {
      await expect(setValue("25")).resolves.toBeDefined();
    });

    it("the most it can be saves", async () => {
      await expect(setValue("20.41")).resolves.toBeDefined();
    });

    it("raising it over the limit is refused, with the most it can be", async () => {
      // 24,500 / 120,000 = 20.4166…% → at most 20.41%.
      await expect(setValue("25")).rejects.toThrow(
        /over the IRS limit — set it to at most 20\.41% of pay/,
      );
    });

    it("an edit that doesn't set a value still saves (the row keeps showing its error)", async () => {
      await expect(
        t.caller.contributionProfile.update({ id: profileId, name: "Renamed" }),
      ).resolves.toBeDefined();
    });

    it("refuses a joint 401(k): IRS limits are per person", async () => {
      await expect(
        t.caller.settings.contributionAccounts.create({
          personId: null,
          jobId: null,
          ownership: "joint",
          accountType: "401k",
          parentCategory: "Retirement",
          taxTreatment: "pre_tax",
          employerMatchType: "none",
          isActive: true,
        } as never),
      ).rejects.toThrow(/choose who owns this account/);
    });
  });

  describe("every write path is checked", () => {
    let rothId: number;
    let iraId: number;
    let b403Id: number;
    const addAccount = (
      values: Partial<typeof schema.contributionAccounts.$inferInsert>,
      fields: Record<string, string>,
    ) => {
      const { id } = t.db
        .insert(schema.contributionAccounts)
        .values({
          personId,
          accountType: "401k",
          parentCategory: "Retirement",
          taxTreatment: "pre_tax",
          employerMatchType: "none",
          isActive: true,
          ownership: "individual",
          ...values,
        })
        .returning({ id: schema.contributionAccounts.id })
        .get();
      const profile = t.db
        .select()
        .from(schema.contributionProfiles)
        .where(eq(schema.contributionProfiles.id, profileId))
        .get()!;
      const af = profile.contributionActiveFields as {
        contributionAccounts: Record<string, unknown>;
      };
      af.contributionAccounts[String(id)] = fields;
      t.db
        .update(schema.contributionProfiles)
        .set({ contributionActiveFields: af })
        .where(eq(schema.contributionProfiles.id, profileId))
        .run();
      return id;
    };

    beforeAll(() => {
      // The Traditional 401(k) sits at its most (20.41%) from above.
      rothId = addAccount(
        { taxTreatment: "tax_free", jobId },
        { contributionValue: "0", contributionMethod: "percent_of_salary" },
      );
      iraId = addAccount(
        { accountType: "ira", jobId: null },
        { contributionValue: "100", contributionMethod: "fixed_monthly" },
      );
      b403Id = addAccount(
        { accountType: "403b", isActive: false, jobId },
        { contributionValue: "5", contributionMethod: "percent_of_salary" },
      );
    });

    it("a second row in a full group: lower the other one first", async () => {
      await expect(
        t.caller.contributionProfile.setAccountActiveFields({
          profileId,
          accountId: rothId,
          fields: {
            contributionValue: "5",
            contributionMethod: "percent_of_salary",
          },
        }),
      ).rejects.toThrow(/already fill it: lower those first/);
    });

    it("a budget edit can't push a contribution over its limit", async () => {
      await expect(
        applyContributionAccountEdit(
          t.db as never,
          iraId,
          1000, // 12,000 a year against a 7,500 IRA limit
          profileId,
          assertWithinIrsLimits,
        ),
      ).rejects.toThrow(/over the IRS limit/);
    });

    it("turning an account back on can't push the group over", async () => {
      await expect(
        t.caller.settings.contributionAccounts.setActive({
          id: b403Id,
          isActive: true,
        }),
      ).rejects.toThrow(/over the IRS limit/);
    });

    it("the refusal names the account the way the app does (owner + display label)", async () => {
      await expect(
        t.caller.settings.contributionAccounts.setActive({
          id: b403Id,
          isActive: true,
        }),
      ).rejects.toThrow(/^Test Person 403b: \$[\d,]+ over the IRS limit/);
    });
  });

  describe("a profile used as a future switch: saved, with a warning", () => {
    let switchProfileId: number;
    const setValue = (contributionValue: string) =>
      t.caller.contributionProfile.setAccountActiveFields({
        profileId: switchProfileId,
        accountId,
        fields: { contributionValue, contributionMethod: "percent_of_salary" },
      });

    beforeAll(() => {
      switchProfileId = seedContributionProfile(t.db, {
        name: "Later",
        contributionActiveFields: { contributionAccounts: {}, jobs: {} },
      });
    });

    it("not used anywhere: no warning", async () => {
      expect((await setValue("30")).limitWarning).toBeNull();
    });

    it("used from 2030: saves, warning with the year and the most it can be", async () => {
      t.db
        .insert(schema.retirementSalaryOverrides)
        .values({
          personId,
          projectionYear: 2030,
          overrideSalary: "120000",
          contributionProfileId: switchProfileId,
        })
        .run();
      const saved = await setValue("31");
      // 36 now, so 40–64 in 2030–2054: over every year at 31%.
      expect(saved.limitWarning).toMatch(
        /^Over the IRS limits in 2030–2054 at those years' ages .* 2030: /,
      );
      expect(saved.limitWarning).toMatch(
        /over the IRS limit — set it to at most 20\.41% of pay/,
      );
      // Within the limit: the warning clears.
      expect((await setValue("20")).limitWarning).toBeNull();
    });

    it("each year at its own ages: catch-up room from 50, super catch-up 60–63", async () => {
      // 28% = 33,600: over at 40–49 (24,500) and 50–59 (32,500), within
      // at 60–63 (35,750), over again at 64 (32,500).
      expect((await setValue("28")).limitWarning).toMatch(
        /^Over the IRS limits in 2030–2049, 2054 at those years' ages/,
      );
    });

    it("a past switch and a later one to the same profile: each capped at its years' ages", async () => {
      await setValue("30");
      t.db.delete(schema.retirementSalaryOverrides).run();
      t.db
        .insert(schema.retirementSalaryOverrides)
        .values(
          [2025, 2045].map((projectionYear) => ({
            personId,
            projectionYear,
            overrideSalary: "120000",
            contributionProfileId: switchProfileId,
          })),
        )
        .run();
      const data = await fetchRetirementData(t.db, {
        contributionProfileId: profileId,
      });
      const payload = (await buildEnginePayload(t.db, data, {
        contributionProfileId: profileId,
      }))!;
      expect(
        payload.baseEngineInput.profileSwitches!.map((s) => [
          s.year,
          Math.round(s.baseYearContributions["401k"]),
        ]),
      ).toEqual([
        [2025, 24500],
        [2040, 32500],
        [2045, 32500],
        [2050, 35750],
        [2054, 32500],
      ]);
      // Restore the 2030 switch the next test reads.
      t.db.delete(schema.retirementSalaryOverrides).run();
      t.db
        .insert(schema.retirementSalaryOverrides)
        .values({
          personId,
          projectionYear: 2030,
          overrideSalary: "120000",
          contributionProfileId: switchProfileId,
        })
        .run();
    });

    it("the projection caps the switch at each year's ages", async () => {
      await setValue("30"); // 36,000
      const data = await fetchRetirementData(t.db, {
        contributionProfileId: profileId,
      });
      const payload = (await buildEnginePayload(t.db, data, {
        contributionProfileId: profileId,
      }))!;
      const switches = payload.baseEngineInput.profileSwitches!.map((s) => [
        s.year,
        Math.round(s.baseYearContributions["401k"]),
      ]);
      // A further switch only where the ages change the cap: 50, 60, 64.
      expect(switches).toEqual([
        [2030, 24500],
        [2040, 32500],
        [2050, 35750],
        [2054, 32500],
      ]);
    });
  });
});
