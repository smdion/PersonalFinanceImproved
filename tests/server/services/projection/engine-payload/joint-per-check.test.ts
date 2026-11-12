/** The Projection reads a household joint row's ownership: a per-check joint amount runs on the
 *  household's one pay schedule (owner, "LM10 applicable schedule"). */
import "../../../../routers/setup-mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  createTestCaller,
  seedStandardDataset,
  seedContributionProfile,
} from "../../../../routers/setup";
import { buildEnginePayload } from "@/server/services/projection/engine-payload/build-engine-payload";
import { fetchRetirementData } from "@/server/services/projection/engine-payload/load";
import * as schema from "@/lib/db/schema-sqlite";

describe("Projection: a joint $100 per check in a one-schedule household", () => {
  let testCaller: Awaited<ReturnType<typeof createTestCaller>>;
  let specs: { ownership?: string; baseAnnual: number; value: number }[];

  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T12:00:00Z"));
    testCaller = await createTestCaller();
    const { db } = testCaller;
    const { personId } = seedStandardDataset(db);
    db.insert(schema.retirementSettings)
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
    const joint = db
      .insert(schema.contributionAccounts)
      .values({
        personId: null,
        jobId: null,
        ownership: "joint",
        accountType: "brokerage",
        parentCategory: "Portfolio",
        taxTreatment: "after_tax",
        employerMatchType: "none",
        isActive: true,
      })
      .returning({ id: schema.contributionAccounts.id })
      .get();
    const profileId = seedContributionProfile(db, {
      name: "Joint per check",
      contributionActiveFields: {
        contributionAccounts: {
          [String(joint.id)]: {
            contributionValue: "100",
            contributionMethod: "fixed_per_period",
          },
        },
      },
    });
    const data = await fetchRetirementData(testCaller.rawDb, {
      contributionProfileId: profileId,
    });
    const result = await buildEnginePayload(testCaller.rawDb, data, {
      asOf: new Date(),
      contributionProfileId: profileId,
    });
    specs = result!.baseEngineInput.contributionSpecs ?? [];
  });

  afterAll(async () => {
    await testCaller.cleanup();
    vi.useRealTimers();
  });

  it("counts $2,600 a year (26 biweekly checks), not $0", () => {
    const spec = specs.find((s) => s.ownership === "joint");
    expect(spec?.baseAnnual).toBe(2600);
  });
});
