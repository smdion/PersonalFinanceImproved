/**
 * Every edit to a year's account rows keeps annual_performance in step —
 * through one path (syncYearRollups):
 *  - a finalized year takes only the edit's change: its category and
 *    Portfolio rows (whatever they held, overrides included) and every later
 *    lifetime total move by exactly what moved, nothing is recomputed;
 *  - an open year is rebuilt from its account rows by account type,
 *    rollovers included, and never stores a Retirement row;
 *  - a snapshot only sets ending balances when it's its year's latest and
 *    the year isn't finalized.
 */
import "./setup-mocks";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema-sqlite";
import {
  createTestCaller,
  seedPerformanceAccount,
  seedSnapshot,
} from "./setup";
import { refreshSnapshotYearDerivatives } from "@/server/helpers/snapshot-derivatives";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

type Ctx = Awaited<ReturnType<typeof createTestCaller>>;
let t: Ctx;
let k401: number;
let brokerage: number;

const flows = {
  totalContributions: "0",
  employerContributions: "0",
  distributions: "0",
  fees: "0",
  rollovers: "0",
};

function acctRow(
  year: number,
  performanceAccountId: number,
  v: Partial<typeof schema.accountPerformance.$inferInsert>,
) {
  return t.db
    .insert(schema.accountPerformance)
    .values({
      year,
      institution: "Inst",
      accountLabel: `acct ${performanceAccountId}`,
      parentCategory: "Retirement",
      performanceAccountId,
      beginningBalance: "0",
      yearlyGainLoss: "0",
      endingBalance: "0",
      ...flows,
      ...v,
    })
    .returning({ id: schema.accountPerformance.id })
    .get().id;
}

function annual(
  year: number,
  category: string,
  v: Partial<typeof schema.annualPerformance.$inferInsert>,
) {
  t.db
    .insert(schema.annualPerformance)
    .values({
      year,
      category,
      beginningBalance: "0",
      totalContributions: "0",
      yearlyGainLoss: "0",
      endingBalance: "0",
      lifetimeGains: "0",
      lifetimeContributions: "0",
      lifetimeMatch: "0",
      ...v,
    })
    .run();
}

const row = (year: number, category: string) =>
  t.db
    .select()
    .from(schema.annualPerformance)
    .where(
      and(
        eq(schema.annualPerformance.year, year),
        eq(schema.annualPerformance.category, category),
      ),
    )
    .get();

beforeEach(async () => {
  t = await createTestCaller();
  k401 = seedPerformanceAccount(t.db, { accountType: "401k", name: "K" });
  brokerage = seedPerformanceAccount(t.db, {
    accountType: "brokerage",
    parentCategory: "Portfolio",
    name: "B",
  });
});
afterEach(() => t.cleanup());

describe("a finalized year takes only the edit's change", () => {
  let brokerageRow: number;
  const locked = { isFinalized: true, isImmutable: true };

  beforeEach(() => {
    acctRow(2030, k401, {
      beginningBalance: "1000",
      yearlyGainLoss: "100",
      endingBalance: "1100",
    });
    brokerageRow = acctRow(2030, brokerage, {
      beginningBalance: "500",
      totalContributions: "300",
      yearlyGainLoss: "200",
      endingBalance: "1000",
    });
    // Category rows match their accounts; Portfolio carries an override
    // (+50 gain) and lifetime baselines from before tracking began.
    annual(2030, "401k/IRA", {
      ...locked,
      beginningBalance: "1000",
      yearlyGainLoss: "100",
      endingBalance: "1100",
      lifetimeGains: "5100",
    });
    annual(2030, "Brokerage", {
      ...locked,
      beginningBalance: "500",
      totalContributions: "300",
      yearlyGainLoss: "200",
      endingBalance: "1000",
      annualReturnPct: "0.300000",
      lifetimeGains: "200",
      lifetimeContributions: "300",
    });
    annual(2030, "Portfolio", {
      ...locked,
      beginningBalance: "1500",
      totalContributions: "300",
      yearlyGainLoss: "350",
      endingBalance: "2100",
      annualReturnPct: "0.200000",
      lifetimeGains: "9350",
      lifetimeContributions: "40300",
    });
    annual(2031, "Brokerage", {
      lifetimeGains: "260",
      lifetimeContributions: "300",
      isCurrentYear: true,
    });
    annual(2031, "Portfolio", {
      lifetimeGains: "9500",
      lifetimeContributions: "40300",
      isCurrentYear: true,
    });
  });

  it("an account edit moves its category, Portfolio and later lifetime totals by the change", async () => {
    await t.caller.performance.updateAccount({
      id: brokerageRow,
      endingBalance: "925",
      yearlyGainLoss: "125",
    });

    const b = row(2030, "Brokerage")!;
    expect(b.endingBalance).toBe("925.00");
    expect(b.yearlyGainLoss).toBe("125.00");
    expect(b.lifetimeGains).toBe("125.00");
    // Stored 30% on a 200 gain = 666.67 of capital; a gain-only edit keeps it.
    expect(Number(b.annualReturnPct)).toBeCloseTo(125 / (200 / 0.3), 6);

    const p = row(2030, "Portfolio")!;
    expect(p.yearlyGainLoss).toBe("275.00"); // the +50 override survives
    expect(p.endingBalance).toBe("2025.00");
    expect(p.lifetimeGains).toBe("9275.00"); // baseline kept, not re-summed
    expect(p.lifetimeContributions).toBe("40300.00");
    expect(Number(p.annualReturnPct)).toBeCloseTo(275 / (350 / 0.2), 6);

    expect(row(2031, "Brokerage")!.lifetimeGains).toBe("185.00");
    expect(row(2031, "Portfolio")!.lifetimeGains).toBe("9425.00");
    expect(row(2030, "401k/IRA")!.lifetimeGains).toBe("5100");
    expect(row(2030, "Retirement")).toBeUndefined();
  });

  it("an edit that changes nothing changes no rollup", async () => {
    await t.caller.performance.updateAccount({
      id: brokerageRow,
      endingBalance: "1000",
    });
    expect(row(2030, "Portfolio")!.yearlyGainLoss).toBe("350");
    expect(row(2031, "Portfolio")!.lifetimeGains).toBe("9500");
  });

  it("an account changing type moves its figures between categories; Portfolio holds", async () => {
    await t.caller.performance.performanceAccounts.update({
      id: brokerage,
      institution: "Inst",
      accountType: "ira",
      ownershipType: "individual",
      parentCategory: "Retirement",
    });
    expect(row(2030, "Brokerage")!.endingBalance).toBe("0.00");
    expect(row(2030, "401k/IRA")!.endingBalance).toBe("2100.00");
    expect(row(2030, "Portfolio")!.endingBalance).toBe("2100");
    expect(row(2030, "Retirement")).toBeUndefined();
  });
});

describe("an open year is rebuilt from its account rows", () => {
  it("by account type, rollovers included; a stored Retirement row goes", async () => {
    const id = acctRow(2032, brokerage, {
      beginningBalance: "100",
      endingBalance: "100",
    });
    acctRow(2032, k401, { beginningBalance: "1000", endingBalance: "1000" });
    annual(2031, "Brokerage", {
      isFinalized: true,
      lifetimeGains: "10",
      lifetimeContributions: "5",
    });
    annual(2032, "Retirement", { isCurrentYear: true, endingBalance: "999" });
    annual(2032, "Portfolio", { isCurrentYear: true });

    await t.caller.performance.batchUpdateAccounts({
      accounts: [
        {
          id,
          totalContributions: "50",
          employerContributions: "0",
          distributions: "0",
          rollovers: "400",
          fees: "0",
          endingBalance: "600",
          yearlyGainLoss: "50",
        },
      ],
    });

    const b = row(2032, "Brokerage")!;
    expect(b).toMatchObject({
      rollovers: "400.00",
      endingBalance: "600.00",
      lifetimeGains: "60.00",
      lifetimeContributions: "55.00",
    });
    expect(row(2032, "401k/IRA")!.endingBalance).toBe("1000.00");
    expect(row(2032, "Portfolio")!.endingBalance).toBe("1600.00");
    expect(row(2032, "Retirement")).toBeUndefined();
  });
});

describe("snapshots set ending balances only when they're the year's latest", () => {
  const sync = (date: string, amount: string) =>
    t.db.transaction((tx) =>
      refreshSnapshotYearDerivatives(tx as never, date, [
        { performanceAccountId: brokerage, amount },
      ]),
    );

  it("a back-dated snapshot leaves the year's ending alone", async () => {
    acctRow(2032, brokerage, { endingBalance: "700" });
    seedSnapshot(t.db, "2032-06-01", [
      { performanceAccountId: brokerage, amount: "700" },
    ]);
    seedSnapshot(t.db, "2032-03-01", [
      { performanceAccountId: brokerage, amount: "500" },
    ]);
    expect(await sync("2032-03-01", "500")).toBe("earlier-snapshot");
    expect(
      t.db
        .select()
        .from(schema.accountPerformance)
        .where(eq(schema.accountPerformance.year, 2032))
        .get()!.endingBalance,
    ).toBe("700");
  });

  it("a later year's snapshot doesn't make an earlier one stale", async () => {
    acctRow(2032, brokerage, { endingBalance: "700" });
    seedSnapshot(t.db, "2033-01-05", [
      { performanceAccountId: brokerage, amount: "900" },
    ]);
    seedSnapshot(t.db, "2032-12-31", [
      { performanceAccountId: brokerage, amount: "800" },
    ]);
    expect(await sync("2032-12-31", "800")).toBe("synced");
  });

  it("a finalized year is left alone", async () => {
    acctRow(2030, brokerage, { endingBalance: "700" });
    annual(2030, "Portfolio", { isFinalized: true, endingBalance: "700" });
    seedSnapshot(t.db, "2030-12-31", [
      { performanceAccountId: brokerage, amount: "800" },
    ]);
    expect(await sync("2030-12-31", "800")).toBe("year-finalized");
    expect(row(2030, "Portfolio")!.endingBalance).toBe("700");
  });
});

describe("computeSummary carries each row's checks", () => {
  it("a year that doesn't continue the last, and an ending off its year-end snapshot", async () => {
    acctRow(2031, brokerage, { beginningBalance: "100", endingBalance: "100" });
    const id = acctRow(2032, brokerage, {
      beginningBalance: "175",
      endingBalance: "175",
    });
    seedSnapshot(t.db, "2032-12-31", [
      { performanceAccountId: brokerage, amount: "180" },
    ]);
    const res = await t.caller.performance.computeSummary();
    const row = res.accountRows.find((r) => r.id === id)!;
    expect(row.checks.map((c) => [c.kind, c.amount])).toEqual([
      ["chain", 75],
      ["snapshot", -5],
    ]);
  });
});

describe("editing a row: balance, next year, preview", () => {
  const lockedYear = { isFinalized: true, isImmutable: true };
  let n: number;
  let next: number;

  beforeEach(() => {
    // 2030 finalized; 2031 open and began where 2030 ended.
    n = acctRow(2030, brokerage, {
      beginningBalance: "500",
      totalContributions: "300",
      yearlyGainLoss: "200",
      endingBalance: "1000",
    });
    next = acctRow(2031, brokerage, {
      beginningBalance: "1000",
      yearlyGainLoss: "100",
      endingBalance: "1100",
    });
    annual(2030, "Brokerage", {
      ...lockedYear,
      beginningBalance: "500",
      totalContributions: "300",
      yearlyGainLoss: "200",
      endingBalance: "1000",
      lifetimeGains: "700",
    });
    annual(2030, "Portfolio", {
      ...lockedYear,
      beginningBalance: "500",
      totalContributions: "300",
      yearlyGainLoss: "200",
      endingBalance: "1000",
      lifetimeGains: "700",
    });
    annual(2031, "Brokerage", { isCurrentYear: true, lifetimeGains: "800" });
    annual(2031, "Portfolio", { isCurrentYear: true, lifetimeGains: "800" });
  });

  const acct = (id: number) =>
    t.db
      .select()
      .from(schema.accountPerformance)
      .where(eq(schema.accountPerformance.id, id))
      .get()!;

  it("a balanced row's gain follows its ending; a row with a deliberate gap keeps its gain", async () => {
    await t.caller.performance.updateAccount({ id: n, endingBalance: "925" });
    expect(acct(n).yearlyGainLoss).toBe("125.00");

    const gap = acctRow(2032, brokerage, {
      beginningBalance: "0",
      endingBalance: "100",
      yearlyGainLoss: "60",
    });
    await t.caller.performance.updateAccount({ id: gap, endingBalance: "90" });
    expect(acct(gap).yearlyGainLoss).toBe("60");
  });

  it("chained across a finalized year: next year begins at the new ending and every later lifetime total ends where it started", async () => {
    const res = await t.caller.performance.updateAccount({
      id: n,
      endingBalance: "925",
      chainNextYear: true,
    });
    expect(res.preview!.chainable).toEqual({ nextYear: 2031, rowId: next });
    expect(acct(next)).toMatchObject({
      beginningBalance: "925.00",
      yearlyGainLoss: "175.00",
    });
    expect(row(2030, "Brokerage")!.lifetimeGains).toBe("625.00");
    expect(row(2031, "Brokerage")!.lifetimeGains).toBe("800.00");
    expect(row(2031, "Portfolio")!.lifetimeGains).toBe("800.00");
  });

  it("next year with a deliberate gap: only its beginning moves", async () => {
    t.db
      .update(schema.accountPerformance)
      .set({ yearlyGainLoss: "90" })
      .where(eq(schema.accountPerformance.id, next))
      .run();
    await t.caller.performance.updateAccount({
      id: n,
      endingBalance: "925",
      chainNextYear: true,
    });
    expect(acct(next)).toMatchObject({
      beginningBalance: "925.00",
      yearlyGainLoss: "90",
    });
  });

  it("a preview reports every change — the row, next year, rollups, checks — and writes nothing", async () => {
    const res = await t.caller.performance.updateAccount({
      id: n,
      endingBalance: "925",
      chainNextYear: true,
      dryRun: true,
    });
    const p = res.preview!;
    expect(p.accounts.find((a) => a.id === n)!.changes).toEqual([
      { field: "endingBalance", from: 1000, to: 925 },
      { field: "yearlyGainLoss", from: 200, to: 125 },
    ]);
    expect(p.accounts.find((a) => a.id === next)!.changes).toEqual([
      { field: "beginningBalance", from: 1000, to: 925 },
      { field: "yearlyGainLoss", from: 100, to: 175 },
    ]);
    expect(
      p.rollups.find((r) => r.year === 2030 && r.category === "Portfolio")!
        .changes,
    ).toContainEqual({ field: "lifetimeGains", from: 700, to: 625 });
    expect(p.checks[n]).toEqual([]);

    expect(acct(n).endingBalance).toBe("1000");
    expect(acct(next).beginningBalance).toBe("1000");
    expect(row(2030, "Portfolio")!.lifetimeGains).toBe("700");
    const stamp = t.db
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, "performance_last_updated"))
      .get();
    expect(stamp).toBeUndefined();
  });
});
