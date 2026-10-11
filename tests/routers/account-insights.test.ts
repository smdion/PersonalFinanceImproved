/**
 * Portfolio account cards: live status, link coverage and deposit check.
 * Invented household only.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import {
  createTestCaller,
  seedPerformanceAccount,
  seedSnapshot,
} from "./setup";
import { snapshotAccountKey } from "@/lib/pure/portfolio";
import { SK_ACTIVE_CONTRIB_PROFILE_ID } from "@/lib/constants/settings-keys";

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10); // lint-violation-ok: fixture dates compared as UTC days

describe("getAccountInsights", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  let plan: number;
  let ira: number;
  let hsa: number;

  beforeAll(async () => {
    ctx = await createTestCaller();
    const db = ctx.db;
    const alice = db
      .insert(sqliteSchema.people)
      .values({ name: "Alice", dateOfBirth: "1990-01-01" })
      .returning()
      .get().id;
    plan = seedPerformanceAccount(db, {
      institution: "Example Bank",
      accountType: "401k",
      ownerPersonId: alice,
    });
    ira = seedPerformanceAccount(db, {
      institution: "Example Bank",
      accountType: "ira",
      ownerPersonId: alice,
    });
    hsa = seedPerformanceAccount(db, {
      institution: "Other Bank",
      accountType: "hsa",
      ownerPersonId: alice,
    });
    seedSnapshot(db, daysAgo(30), [
      { performanceAccountId: plan, amount: "5000", ownerPersonId: alice },
      {
        performanceAccountId: ira,
        amount: "100",
        taxType: "preTax",
        accountType: "ira",
        ownerPersonId: alice,
      },
      {
        performanceAccountId: ira,
        amount: "900",
        taxType: "taxFree",
        accountType: "ira",
        ownerPersonId: alice,
      },
      {
        performanceAccountId: hsa,
        amount: "700",
        taxType: "hsa",
        accountType: "hsa",
        ownerPersonId: alice,
      },
    ]);
    const sf = (
      externalAccountId: string,
      linked: number,
      subKey: string | null,
      balance: string,
    ) =>
      db
        .insert(sqliteSchema.simplefinAccounts)
        .values({
          externalAccountId,
          orgName: "Example Bank",
          accountName: externalAccountId,
          lastBalance: balance,
          lastBalanceDate: new Date(`${daysAgo(1)}T12:00:00Z`),
          linkedPerformanceAccountId: linked,
          linkedSubKey: subKey,
        })
        .returning()
        .get().id;
    const planFeed = sf("plan", plan, null, "5400");
    sf(
      "roth-ira",
      ira,
      snapshotAccountKey({
        performanceAccountId: ira,
        taxType: "taxFree",
        subType: null,
        ownerPersonId: alice,
      }),
      "950",
    );
    sf("hsa", hsa, null, "750"); // balance only: never sends transactions
    for (let i = 0; i < 4; i++)
      db.insert(sqliteSchema.investmentTransactions)
        .values({
          simplefinAccountId: planFeed,
          externalId: `d${i}`,
          posted: daysAgo(5 + i * 14),
          amount: "300",
          description: "CONTRIBUTION",
          pending: false,
        })
        .run();

    // Setup: $7,800 a year to the plan (300 every 14 days ≈ 7,821).
    const contrib = db
      .insert(sqliteSchema.contributionAccounts)
      .values({
        personId: alice,
        accountType: "401k",
        taxTreatment: "pre_tax",
        employerMatchType: "none",
        performanceAccountId: plan,
      })
      .returning()
      .get().id;
    const profile = db
      .insert(sqliteSchema.contributionProfiles)
      .values({
        name: "Insights",
        contributionActiveFields: {
          contributionAccounts: {
            [contrib]: {
              contributionMethod: "fixed_annual",
              contributionValue: "7800",
            },
          },
        },
      })
      .returning()
      .get().id;
    db.insert(sqliteSchema.appSettings)
      .values({ key: SK_ACTIVE_CONTRIB_PROFILE_ID, value: String(profile) })
      .onConflictDoUpdate({
        target: sqliteSchema.appSettings.key,
        set: { value: String(profile) },
      })
      .run();
  });
  afterAll(() => ctx.cleanup());

  it("reports live balance, link coverage and the deposit check per account", async () => {
    const rows = await ctx.caller.investments.getAccountInsights();
    const by = new Map(rows.map((r) => [r.performanceAccountId, r]));
    expect(by.get(plan)).toMatchObject({
      status: "linked",
      live: { total: 5400, asOf: daysAgo(1) },
      unlinkedParts: [],
      deposits: { verdict: "matches", paydays: 4, typical: 300, everyDays: 14 },
    });
    // Snapshot 5,000 → live 5,400; deposits after the snapshot: 300 × 2.
    expect(by.get(plan)?.sinceSnapshot).toMatchObject({
      snapshotDate: daysAgo(30),
      change: 400,
      added: 600,
      moved: 0,
      markets: -200,
    });
    // Not every part linked: no comparison.
    expect(by.get(ira)?.sinceSnapshot).toBeNull();
    expect(by.get(ira)).toMatchObject({
      live: { total: 950 },
      unlinkedParts: ["Alice — Traditional"],
    });
    expect(by.get(hsa)).toMatchObject({
      status: "balance_only",
      deposits: { verdict: "unknown" },
    });
  });
});
