/**
 * investments.getRothIraInputs — taxable investment income (taxable
 * account types only), pre-tax IRA balances per person (pro-rata), and what
 * the estimate can't see. Invented household only.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import {
  createTestCaller,
  seedPerformanceAccount,
  seedSnapshot,
} from "./setup";

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10); // lint-violation-ok: fixture dates compared as UTC days

describe("investments.getRothIraInputs", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  let alice: number;
  const posted = daysAgo(10);
  const taxYear = Number(posted.slice(0, 4));

  beforeAll(async () => {
    ctx = await createTestCaller();
    const db = ctx.db;
    alice = db
      .insert(sqliteSchema.people)
      .values({ name: "Alice", dateOfBirth: "1980-01-01" })
      .returning()
      .get().id;
    const brokerage = seedPerformanceAccount(db, {
      name: "Taxable",
      institution: "Example Bank",
      accountType: "brokerage",
      ownerPersonId: alice,
    });
    const ira = seedPerformanceAccount(db, {
      name: "IRA",
      institution: "Example Bank",
      accountType: "ira",
      ownerPersonId: alice,
    });
    const unfed = seedPerformanceAccount(db, {
      name: "Paper Brokerage",
      institution: "Other Bank",
      accountType: "brokerage",
      ownerPersonId: alice,
    });
    seedSnapshot(db, daysAgo(30), [
      {
        performanceAccountId: brokerage,
        amount: "20000",
        taxType: "afterTax",
        accountType: "brokerage",
        ownerPersonId: alice,
      },
      {
        performanceAccountId: ira,
        amount: "3000",
        taxType: "preTax",
        accountType: "ira",
        ownerPersonId: alice,
      },
      {
        performanceAccountId: ira,
        amount: "9000",
        taxType: "taxFree",
        accountType: "ira",
        ownerPersonId: alice,
      },
      {
        performanceAccountId: unfed,
        amount: "5000",
        taxType: "afterTax",
        accountType: "brokerage",
        ownerPersonId: alice,
      },
    ]);
    const feed = (id: string, linked: number | null) =>
      db
        .insert(sqliteSchema.simplefinAccounts)
        .values({
          externalAccountId: id,
          orgName: "Example Bank",
          accountName: id,
          lastBalance: "1",
          linkedPerformanceAccountId: linked,
        })
        .returning()
        .get().id;
    const brokerageFeed = feed("taxable", brokerage);
    const iraFeed = feed("ira", ira);
    feed("mystery", null);
    const tx = (
      account: number,
      externalId: string,
      amount: string,
      description: string,
    ) =>
      db
        .insert(sqliteSchema.investmentTransactions)
        .values({
          simplefinAccountId: account,
          externalId,
          posted,
          amount,
          description,
          pending: false,
        })
        .run();
    tx(brokerageFeed, "d1", "120.00", "DIVIDEND RECEIVED");
    tx(brokerageFeed, "i1", "30.00", "INTEREST EARNED");
    tx(iraFeed, "d2", "999.00", "DIVIDEND RECEIVED"); // tax-deferred
    db.insert(sqliteSchema.appSettings)
      .values({
        key: "simplefin_investments_first_synced_at",
        value: new Date().toISOString(),
      })
      .run();
  });

  afterAll(() => ctx.cleanup());

  it("counts dividends and interest in taxable accounts only", async () => {
    const r = await ctx.caller.investments.getRothIraInputs({ taxYear });
    expect(r.investmentIncome.ytd).toBe(150);
    expect(r.investmentIncome.basis).not.toBe("none");
  });

  it("pre-tax IRA balance per person (Roth IRA money doesn't count)", async () => {
    const r = await ctx.caller.investments.getRothIraInputs({ taxYear });
    expect(r.preTaxIraByPerson).toEqual([{ personId: alice, amount: 3000 }]);
    expect(r.unownedPreTaxIra).toBe(0);
  });

  it("names what it can't see", async () => {
    const r = await ctx.caller.investments.getRothIraInputs({ taxYear });
    expect(r.unlinkedFeedCount).toBe(1);
    expect(r.unfedTaxableAccounts).toHaveLength(1);
    expect(r.unfedTaxableAccounts[0]).toMatch(/Other Bank/);
  });
});
