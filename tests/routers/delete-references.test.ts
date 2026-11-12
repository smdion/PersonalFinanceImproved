/** Deleting a row takes its JSON-held references with it: budget-API
 *  mappings (no FK can cascade them) and Contribution Profile active fields.
 *  A mapping left behind keeps a dead link on the sync page; an active-field
 *  entry left behind resurrects on a reused id. */
import "./setup-mocks";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestCaller,
  seedContributionProfile,
  seedJob,
  seedPerformanceAccount,
  seedPerson,
} from "./setup";
import * as schema from "@/lib/db/schema-sqlite";

describe("deletes clear their JSON references", () => {
  it("performance account, debt and asset deletes drop their mappings only", async () => {
    const { caller, db, cleanup } = await createTestCaller();
    try {
      const perfId = seedPerformanceAccount(db);
      const debt = await caller.debts.create({
        name: "Car",
        kind: "auto_loan" as const,
        ownerPersonId: null,
        balance: "5000",
        balanceAsOf: "2026-01-31",
        interestRate: "0.05",
        monthlyPayment: "200",
      });
      const debtId = (debt as { id: number }).id;
      const asset = db
        .insert(schema.otherAssetItems)
        .values({ name: "Car value", year: 2026, value: "9000" })
        .returning({ id: schema.otherAssetItems.id })
        .get();
      db.insert(schema.apiConnections)
        .values({
          service: "actual",
          config: { serverUrl: "x", budgetSyncId: "y" } as never,
          accountMappings: [
            {
              localId: `performance:${perfId}`,
              localName: "401k",
              remoteAccountId: "r1",
              syncDirection: "push",
            },
            {
              localId: `debt:${debtId}`,
              localName: "Car",
              remoteAccountId: "r2",
              syncDirection: "pull",
              debtId,
            },
            {
              localId: `asset:${asset.id}`,
              localName: "Car value",
              remoteAccountId: "r3",
              syncDirection: "pull",
              assetId: asset.id,
            },
            {
              localId: "asset:99999",
              localName: "Someone else",
              remoteAccountId: "r4",
              syncDirection: "pull",
              assetId: 99999,
            },
          ],
        })
        .run();
      const remotes = () =>
        (
          db.select().from(schema.apiConnections).get()!.accountMappings ?? []
        ).map((m) => m.remoteAccountId);

      await caller.performance.performanceAccounts.delete({ id: perfId });
      expect(remotes()).toEqual(["r2", "r3", "r4"]);
      await caller.debts.delete({ id: debtId });
      expect(remotes()).toEqual(["r3", "r4"]);
      await caller.assets.deleteOtherAsset({ id: asset.id });
      expect(remotes()).toEqual(["r4"]);
    } finally {
      cleanup();
    }
  });

  it("contribution account and deduction deletes drop their active fields", async () => {
    const { caller, db, cleanup } = await createTestCaller();
    try {
      const personId = await seedPerson(db, "Pat", "1990-01-01");
      const jobId = seedJob(db, personId);
      const ded = await caller.paycheck.deductions.create({
        jobId,
        deductionName: "Dental",
        isPretax: true,
        ficaExempt: false,
      });
      const profileId = seedContributionProfile(db, {
        contributionActiveFields: {
          deductions: {
            [String(ded!.id)]: { amountPerPeriod: "10" },
            "424242": { amountPerPeriod: "5" },
          },
        },
      });
      await caller.paycheck.deductions.delete({ id: ded!.id });
      const fields = db
        .select()
        .from(schema.contributionProfiles)
        .where(eq(schema.contributionProfiles.id, profileId))
        .get()!.contributionActiveFields;
      expect(Object.keys(fields.deductions ?? {})).toEqual(["424242"]);
    } finally {
      cleanup();
    }
  });
});
