/**
 * Suggested Performance and Roth-basis figures from SimpleFIN transactions.
 * Invented household: Alice and Bob share an IRA tracked per person
 * (Alice's traditional + Roth, Bob's Roth), and Alice has a brokerage her
 * paycheck setup funds with an employer contribution.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import {
  createTestCaller,
  seedPerformanceAccount,
  seedSnapshot,
} from "./setup";
import { snapshotAccountKey } from "@/lib/pure/portfolio";
import { SK_ACTIVE_CONTRIB_PROFILE_ID } from "@/lib/constants/settings-keys";

describe("investment suggestions", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  const ap: Record<string, number> = {};
  const basis: Record<string, number> = {};
  let alice: number;
  let bob: number;
  let addTx: (
    account: number,
    externalId: string,
    posted: string,
    amount: string,
    description: string,
  ) => number;
  let feeds: Record<string, number>;

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
    const ira = seedPerformanceAccount(db, {
      institution: "Example Bank",
      accountType: "ira",
      ownershipType: "joint",
      accountLabel: "IRA",
    });
    const brokerage = seedPerformanceAccount(db, {
      institution: "Example Bank",
      accountType: "brokerage",
      accountLabel: "Brokerage",
      ownerPersonId: null,
      parentCategory: "Portfolio",
    });
    const sub = (taxType: string, owner: number) => ({
      performanceAccountId: ira,
      amount: "10000",
      taxType,
      institution: "Example Bank",
      accountType: "ira",
      ownerPersonId: owner,
    });
    seedSnapshot(db, "2026-03-01", [
      sub("preTax", alice),
      sub("taxFree", alice),
      sub("taxFree", bob),
      {
        performanceAccountId: brokerage,
        amount: "5000",
        taxType: "afterTax",
        institution: "Example Bank",
        accountType: "brokerage",
      },
    ]);
    const key = (taxType: "preTax" | "taxFree", owner: number) =>
      snapshotAccountKey({
        performanceAccountId: ira,
        taxType,
        subType: null,
        ownerPersonId: owner,
      });
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
          linkedPerformanceAccountId: linked,
          linkedSubKey: subKey,
        })
        .returning()
        .get().id;
    const aTrad = sf("a-trad", ira, key("preTax", alice), "9000");
    const aRoth = sf("a-roth", ira, key("taxFree", alice), "11500");
    const bRoth = sf("b-roth", ira, key("taxFree", bob), "10300");
    const brk = sf("brk", brokerage, null, "6100");

    const tx = (
      account: number,
      externalId: string,
      posted: string,
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
        .returning()
        .get().id;
    addTx = tx;
    feeds = { aTrad, aRoth, bRoth, brk };
    tx(aTrad, "t0", "2026-02-20", "999", "DEPOSIT"); // before the stamp
    tx(aTrad, "t1", "2026-03-10", "500", "DEPOSIT");
    tx(aTrad, "t2", "2026-03-12", "-500", "TRANSFER OUT");
    tx(aRoth, "t3", "2026-03-13", "500", "TRANSFER IN");
    tx(bRoth, "t4", "2026-03-15", "300", "DEPOSIT");
    tx(brk, "t5", "2026-03-20", "1000", "DEPOSIT");
    tx(brk, "t6", "2027-01-04", "800", "DEPOSIT"); // next year

    const row = (
      performanceAccountId: number,
      owner: number | null,
      label: string,
    ) =>
      db
        .insert(sqliteSchema.accountPerformance)
        .values({
          year: 2026,
          institution: "Example Bank",
          accountLabel: label,
          ownerPersonId: owner,
          beginningBalance: "10000",
          totalContributions: "1000",
          employerContributions: "200",
          yearlyGainLoss: "0",
          endingBalance: "11000",
          parentCategory: "Retirement",
          performanceAccountId,
        })
        .returning()
        .get().id;
    ap.alice = row(ira, alice, "IRA");
    ap.bob = row(ira, bob, "IRA");
    ap.brokerage = row(brokerage, null, "Brokerage");

    const basisRow = (owner: number) =>
      db
        .insert(sqliteSchema.accountBasis)
        .values({
          performanceAccountId: ira,
          ownerPersonId: owner,
          year: 2026,
          contributionBasis: "2000",
          conversionBasis: "1000",
          latestConversionYear: 2025,
          updatedAt: new Date("2026-03-01T12:00:00Z"),
        })
        .returning()
        .get().id;
    basis.alice = basisRow(alice);
    basis.bob = basisRow(bob);

    db.insert(sqliteSchema.appSettings)
      .values({
        key: "performance_last_updated",
        value: "2026-03-01T12:00:00Z",
      })
      .run();

    // Paycheck setup: $6,000 pre-tax + $2,000 employer to the brokerage.
    const contrib = db
      .insert(sqliteSchema.contributionAccounts)
      .values({
        personId: alice,
        accountType: "brokerage",
        parentCategory: "Portfolio",
        taxTreatment: "after_tax",
        employerMatchType: "fixed_annual",
        employerMatchValue: "2000",
        performanceAccountId: brokerage,
      })
      .returning()
      .get().id;
    const profile = db
      .insert(sqliteSchema.contributionProfiles)
      .values({
        name: "Now",
        contributionActiveFields: {
          contributionAccounts: {
            [contrib]: {
              contributionMethod: "fixed_annual",
              contributionValue: "6000",
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

  it("adds what came in since the last update onto each Performance row", async () => {
    const s = await ctx.caller.investments.suggestPerformance({ year: 2026 });
    const by = new Map(s.accounts.map((a) => [a.accountPerformanceId, a]));

    // Alice: $500 deposited; the conversion is a move within her own row.
    expect(by.get(ap.alice!)).toMatchObject({
      feed: "linked",
      baseline: "2026-03-01",
      suggested: {
        employeeContrib: 1300,
        employerContributions: 200,
        rollovers: 0,
        endingBalance: 20500,
      },
    });
    expect(by.get(ap.bob!)?.suggested).toMatchObject({
      employeeContrib: 1100,
      endingBalance: 10300,
    });
    // Brokerage: $1,000 split 3:1 by the paycheck setup; next January's
    // deposit belongs to next year.
    expect(by.get(ap.brokerage!)).toMatchObject({
      added: { employee: 750, employer: 250, estimated: true },
      suggested: {
        employeeContrib: 1550,
        employerContributions: 450,
        endingBalance: 6100,
      },
    });
  });

  it("counts saved this year as recorded plus what's new since the last fill", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T12:00:00"));
    try {
      const [pace, perf] = await Promise.all([
        ctx.caller.investments.getSavingsThisYear(),
        ctx.caller.investments.suggestPerformance({ year: 2026 }),
      ]);
      const brokerage = perf.accounts.find(
        (a) => a.accountPerformanceId === ap.brokerage,
      )!;
      const row = pace.accounts.find(
        (a) => a.performanceAccountId === brokerage.performanceAccountId,
      )!;
      // Recorded $1,000 ($800 + $200 employer) + the $1,000 deposit not yet filled.
      expect(row).toMatchObject({ recorded: 1000, pending: 1000, saved: 2000 });
      expect(row.planYear).toBeGreaterThan(0);
      // The total covers the accounts with a paycheck plan.
      expect(pace.total.saved).toBeCloseTo(
        pace.accounts
          .filter((a) => a.planYear > 0)
          .reduce((t, a) => t + a.saved, 0),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers only what a saved fill hasn't counted, late arrivals included", async () => {
    const before = await ctx.caller.investments.suggestPerformance({
      year: 2026,
    });
    const bobRow = before.accounts.find(
      (a) => a.accountPerformanceId === ap.bob,
    )!;
    await ctx.caller.performance.batchUpdateAccounts({
      accounts: [
        {
          id: ap.bob!,
          totalContributions: "1300",
          employerContributions: "200",
          distributions: "0",
          rollovers: "0",
          fees: "0",
          endingBalance: "10300",
          yearlyGainLoss: "0",
        },
      ],
      simplefinFill: {
        year: 2026,
        baselines: { [ap.bob!]: bobRow.baseline },
        counted: { ...bobRow.counted, 999999: "contribution" },
      },
    });
    // A row that arrives afterwards, dated before the save.
    addTx(feeds.bRoth!, "late", "2026-03-14", "40", "DEPOSIT");

    const after = await ctx.caller.investments.suggestPerformance({
      year: 2026,
    });
    const bob = after.accounts.find((a) => a.accountPerformanceId === ap.bob)!;
    // The save moved "last updated" to today, but the row keeps its baseline.
    expect(bob.baseline).toBe("2026-03-01");
    expect(bob.added).toMatchObject({ contributions: 40, count: 1 });
  });

  it("adds Roth contributions and conversions to each person's basis, less money taken out", async () => {
    addTx(feeds.bRoth!, "w1", "2026-03-20", "-100", "WITHDRAWAL");
    const s = await ctx.caller.investments.suggestBasis({ year: 2026 });
    const by = new Map(s.accounts.map((a) => [a.ownerPersonId, a]));
    expect(by.get(alice)).toMatchObject({
      accountBasisId: basis.alice,
      added: { contributions: 0, conversions: 500 },
      suggested: {
        contributionBasis: 2000,
        conversionBasis: 1500,
        latestConversionYear: 2026,
      },
    });
    // Bob: 2,000 + 300 + 40 deposited, 100 out of contributions first.
    expect(by.get(bob)).toMatchObject({
      added: { contributions: 340, conversions: 0, outflow: 100 },
      suggested: {
        contributionBasis: 2240,
        conversionBasis: 1000,
        latestConversionYear: 2025,
      },
    });
  });

  it("records a basis fill so it isn't offered again", async () => {
    const s = await ctx.caller.investments.suggestBasis({ year: 2026 });
    const row = s.accounts.find((a) => a.ownerPersonId === bob)!;
    await ctx.caller.taxBuckets.batchUpdateRothBasis({
      entries: [
        {
          performanceAccountId: row.performanceAccountId,
          ownerPersonId: bob,
          year: 2026,
          contributionBasis: "2240",
          conversionBasis: "1000",
          latestConversionYear: 2025,
        },
      ],
      simplefinFill: {
        year: 2026,
        baselines: { [row.accountBasisId]: row.baseline },
        counted: row.counted,
      },
    });
    const again = await ctx.caller.investments.suggestBasis({ year: 2026 });
    expect(
      again.accounts.find((a) => a.ownerPersonId === bob)?.added.count,
    ).toBe(0);
  });

  it("suggests snapshot balances from linked accounts", async () => {
    const s = await ctx.caller.investments.suggestSnapshot();
    expect(s.amounts.map((r) => r.amount).sort((x, y) => x - y)).toEqual([
      6100, 9000, 10300, 11500,
    ]);
    expect(s.accounts.every((a) => !a.split)).toBe(true);
  });

  it("counts from the start of the year when a row still holds last year's basis", async () => {
    const alice2026 = (
      await ctx.caller.investments.suggestBasis({ year: 2026 })
    ).accounts.find((a) => a.ownerPersonId === alice)!;
    expect(alice2026.baseline).toBe("2026-03-01");
    ctx.db
      .insert(sqliteSchema.accountBasis)
      .values({
        performanceAccountId: alice2026.performanceAccountId,
        ownerPersonId: alice,
        year: 2025,
        contributionBasis: "2000",
        conversionBasis: "1000",
        latestConversionYear: 2025,
      })
      .run();
    const again = (
      await ctx.caller.investments.suggestBasis({ year: 2026 })
    ).accounts.find((a) => a.ownerPersonId === alice)!;
    expect(again.baseline).toBe("2025-12-31");
  });

  it("estimates contributions from the paycheck setup for an account with no feed", async () => {
    const db = ctx.db;
    const hsa = seedPerformanceAccount(db, {
      institution: "Other Bank",
      accountType: "hsa",
      accountLabel: "HSA",
      ownerPersonId: bob,
    });
    const row = db
      .insert(sqliteSchema.accountPerformance)
      .values({
        year: 2026,
        institution: "Other Bank",
        accountLabel: "HSA",
        ownerPersonId: bob,
        beginningBalance: "1000",
        totalContributions: "300",
        employerContributions: "0",
        yearlyGainLoss: "0",
        endingBalance: "1300",
        parentCategory: "Retirement",
        performanceAccountId: hsa,
      })
      .returning()
      .get().id;
    const contrib = db
      .insert(sqliteSchema.contributionAccounts)
      .values({
        personId: bob,
        accountType: "hsa",
        taxTreatment: "hsa",
        employerMatchType: "none",
        performanceAccountId: hsa,
      })
      .returning()
      .get().id;
    const profile = db
      .select()
      .from(sqliteSchema.contributionProfiles)
      .all()
      .find((p) => p.name === "Now")!;
    const fields = profile.contributionActiveFields as {
      contributionAccounts: Record<string, unknown>;
    };
    fields.contributionAccounts[contrib] = {
      contributionMethod: "fixed_annual",
      contributionValue: "3650",
    };
    db.update(sqliteSchema.contributionProfiles)
      .set({ contributionActiveFields: fields })
      .where(eq(sqliteSchema.contributionProfiles.id, profile.id))
      .run();

    // An earlier save stamped "last updated" today; start this row in March.
    db.update(sqliteSchema.appSettings)
      .set({ value: "2026-03-01T12:00:00Z" })
      .where(eq(sqliteSchema.appSettings.key, "performance_last_updated"))
      .run();
    const s = await ctx.caller.investments.suggestPerformance({ year: 2026 });
    const hsaRow = s.accounts.find((a) => a.accountPerformanceId === row)!;
    const to =
      new Date().toISOString().slice(0, 10) < "2026-12-31" // lint-violation-ok: compared as UTC days, as the router does
        ? new Date().toISOString().slice(0, 10) // lint-violation-ok: UTC day key
        : "2026-12-31";
    const days = (Date.parse(to) - Date.parse(hsaRow.since)) / 86_400_000;
    expect(hsaRow.feed).toBe("none");
    expect(hsaRow.estimate).toMatchObject({ through: to });
    expect(hsaRow.estimate!.employee).toBeCloseTo(days * 10, 2);
    expect(hsaRow.suggested.employeeContrib).toBeCloseTo(300 + days * 10, 2);

    // Saved: a second fill doesn't estimate the same days again.
    await ctx.caller.performance.batchUpdateAccounts({
      accounts: [
        {
          id: row,
          totalContributions: hsaRow.suggested.employeeContrib.toFixed(2),
          employerContributions: "0",
          distributions: "0",
          rollovers: "0",
          fees: "0",
          endingBalance: "1300",
          yearlyGainLoss: "0",
        },
      ],
      simplefinFill: {
        year: 2026,
        baselines: { [row]: hsaRow.baseline },
        counted: {},
        estimatedThrough: { [row]: hsaRow.estimate!.through },
      },
    });
    const again = await ctx.caller.investments.suggestPerformance({
      year: 2026,
    });
    expect(
      again.accounts.find((a) => a.accountPerformanceId === row)!.estimate,
    ).toMatchObject({
      employee: 0,
    });

    // Linked, but the institution only ever sends a balance: still estimated,
    // with the ending balance from SimpleFIN.
    db.insert(sqliteSchema.simplefinAccounts)
      .values({
        externalAccountId: "hsa-balance-only",
        orgName: "Other Bank",
        accountName: "Health Savings Account",
        lastBalance: "4321",
        linkedPerformanceAccountId: hsa,
      })
      .run();
    // Forget the saved estimate so this fill starts from the row's baseline.
    db.delete(sqliteSchema.appSettings)
      .where(eq(sqliteSchema.appSettings.key, "simplefin_fill_ledger"))
      .run();
    const linked = (
      await ctx.caller.investments.suggestPerformance({ year: 2026 })
    ).accounts.find((a) => a.accountPerformanceId === row)!;
    expect(linked).toMatchObject({
      feed: "linked",
      balanceOnly: true,
      suggested: { endingBalance: 4321 },
    });
    expect(linked.estimate).not.toBeNull();
  });

  it("ignores an unchecked account everywhere while keeping its link", async () => {
    ctx.db
      .update(sqliteSchema.simplefinAccounts)
      .set({ isIncluded: false })
      .where(eq(sqliteSchema.simplefinAccounts.id, feeds.brk!))
      .run();
    const snap = await ctx.caller.investments.suggestSnapshot();
    expect(snap.amounts.some((r) => r.amount === 6100)).toBe(false);
    const insights = await ctx.caller.investments.getAccountInsights();
    expect(insights.every((i) => i.live?.total !== 6100)).toBe(true);
    const listed = await ctx.caller.simplefin.listAccounts();
    expect(listed.find((r) => r.id === feeds.brk)).toMatchObject({
      linkedPerformanceAccountId: expect.any(Number),
      change: null,
    });
    ctx.db
      .update(sqliteSchema.simplefinAccounts)
      .set({ isIncluded: true })
      .where(eq(sqliteSchema.simplefinAccounts.id, feeds.brk!))
      .run();
  });

  it("gives live year-to-date per account, split employee / employer", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T12:00:00"));
    try {
      const { loadLiveContributions, liveYearToDate } =
        await import("@/server/routers/investments/live-contributions");
      const perf = await ctx.caller.investments.suggestPerformance({
        year: 2026,
      });
      const row = perf.accounts.find(
        (a) => a.accountPerformanceId === ap.brokerage,
      )!;
      const live = (
        await loadLiveContributions(ctx.db as never, "2026-10-12")
      ).find((c) => c.performanceAccountId === row.performanceAccountId)!;
      // Performance's figures split employee / employer, plus exactly what
      // the Performance fill would add now (the same loader).
      expect(live.recorded.employer).toBeGreaterThan(0);
      expect(live.pending).toEqual({
        employee: row.added.employee,
        employer: row.added.employer,
      });
      const ytd = liveYearToDate(live);
      expect(ytd.contributions).toBeCloseTo(
        live.recorded.employee + live.pending.employee + live.unposted.employee,
      );
      expect(ytd.employerMatch).toBeCloseTo(
        live.recorded.employer + live.pending.employer + live.unposted.employer,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("needs the portfolio permission", async () => {
    const { createViewerSessionWithPermissions } = await import("./setup");
    const other = await createTestCaller(
      createViewerSessionWithPermissions(["performance"]),
    );
    try {
      await expect(
        other.caller.investments.suggestPerformance({ year: 2026 }),
      ).rejects.toThrow();
    } finally {
      other.cleanup();
    }
  });
});
