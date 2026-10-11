/**
 * Linking SimpleFIN accounts to sub-accounts, and suggested links.
 * Invented household: a joint IRA holding two people's Roth sub-accounts.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import {
  createTestCaller,
  seedPerformanceAccount,
  seedSnapshot,
} from "./setup";
import { snapshotAccountKey } from "@/lib/pure/portfolio";

describe("simplefin sub-account links", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  let ira: number;
  let alice: number;
  let bob: number;
  const sf: Record<string, number> = {};
  const key = (owner: number) =>
    snapshotAccountKey({
      performanceAccountId: ira,
      taxType: "taxFree",
      subType: null,
      ownerPersonId: owner,
    });

  beforeAll(async () => {
    ctx = await createTestCaller();
    const db = ctx.db;
    const person = (name: string) =>
      db
        .insert(sqliteSchema.people)
        .values({ name, dateOfBirth: "1990-01-01" })
        .returning()
        .get().id;
    alice = person("Alice");
    bob = person("Bob");
    ira = seedPerformanceAccount(db, {
      institution: "Example Bank",
      accountType: "ira",
      ownershipType: "joint",
      accountLabel: "IRA (Example Bank)",
    });
    seedSnapshot(db, "2026-09-01", [
      {
        performanceAccountId: ira,
        amount: "190000",
        taxType: "taxFree",
        institution: "Example Bank",
        accountType: "ira",
        ownerPersonId: alice,
      },
      {
        performanceAccountId: ira,
        amount: "100000",
        taxType: "taxFree",
        institution: "Example Bank",
        accountType: "ira",
        ownerPersonId: bob,
      },
    ]);
    const add = (name: string, externalAccountId: string, balance: string) => {
      sf[name] = db
        .insert(sqliteSchema.simplefinAccounts)
        .values({
          externalAccountId,
          orgName: "Example Bank",
          accountName: "Roth IRA Brokerage Account",
          lastBalance: balance,
        })
        .returning()
        .get().id;
    };
    add("a", "sf-a", "195000");
    add("b", "sf-b", "98000");
  });
  afterAll(() => ctx.cleanup());

  it("offers each sub-account of a tracked account", async () => {
    const m = (await ctx.caller.simplefin.listMatchableAccounts()).find(
      (a) => a.id === ira,
    )!;
    expect(m.subAccounts.map((s) => s.label).sort()).toEqual(
      ["Alice — Roth", "Bob — Roth"].sort(),
    );
  });

  it("suggests each person's Roth by balance", async () => {
    const rows = await ctx.caller.simplefin.listAccounts();
    expect(rows.find((r) => r.id === sf.a)?.suggestion).toMatchObject({
      performanceAccountId: ira,
      subKey: key(alice),
    });
    expect(rows.find((r) => r.id === sf.b)?.suggestion).toMatchObject({
      performanceAccountId: ira,
      subKey: key(bob),
    });
  });

  it("rejects a sub-account that isn't in the latest snapshot", async () => {
    await expect(
      ctx.caller.simplefin.setAccountMapping({
        id: sf.a!,
        performanceAccountId: ira,
        subKey: "nope",
      }),
    ).rejects.toThrow(/latest snapshot/);
  });

  it("never suggests a sub-account that's already linked", async () => {
    // The household links B to Alice's Roth by hand (deliberately).
    await ctx.caller.simplefin.setAccountMapping({
      id: sf.b!,
      performanceAccountId: ira,
      subKey: key(alice),
    });
    const rows = await ctx.caller.simplefin.listAccounts();
    expect(rows.find((r) => r.id === sf.a)?.suggestion).toMatchObject({
      subKey: key(bob),
    });
    expect(rows.find((r) => r.id === sf.b)).toMatchObject({
      linkedSubLabel: "Alice — Roth",
      suggestion: null,
    });
  });

  it("links the remaining suggestions without touching existing links", async () => {
    expect(await ctx.caller.simplefin.acceptLinkSuggestions({})).toEqual({
      linked: 1,
    });
    const rows = ctx.db.select().from(sqliteSchema.simplefinAccounts).all();
    expect(rows.find((r) => r.id === sf.a)?.linkedSubKey).toBe(key(bob));
    expect(rows.find((r) => r.id === sf.b)?.linkedSubKey).toBe(key(alice));
  });

  it("flags a link whose sub-account left the snapshot, keeping it", async () => {
    ctx.db
      .update(sqliteSchema.portfolioAccounts)
      .set({ isActive: false })
      .where(eq(sqliteSchema.portfolioAccounts.ownerPersonId, bob))
      .run();
    const row = (await ctx.caller.simplefin.listAccounts()).find(
      (r) => r.id === sf.a,
    )!;
    expect(row).toMatchObject({
      linkedPerformanceAccountId: ira,
      linkedSubKey: key(bob),
      subLinkMissing: true,
    });
  });

  it("whole-account links stay as before", async () => {
    await ctx.caller.simplefin.setAccountMapping({
      id: sf.a!,
      performanceAccountId: ira,
    });
    const row = ctx.db
      .select()
      .from(sqliteSchema.simplefinAccounts)
      .where(eq(sqliteSchema.simplefinAccounts.id, sf.a!))
      .get()!;
    expect(row).toMatchObject({
      linkedPerformanceAccountId: ira,
      linkedSubKey: null,
    });
  });
});
