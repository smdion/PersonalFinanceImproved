/**
 * Notes, estimated marks and accepted gaps on Performance account rows:
 * accepting reads the gap from the checks themselves, needs its own
 * reason, and the check returns when the gap changes; a snapshot's real
 * balance clears the ending's estimate mark.
 */
import "./setup-mocks";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
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

let t: Awaited<ReturnType<typeof createTestCaller>>;
let acct: number;

const insertRow = (v: Partial<typeof schema.accountPerformance.$inferInsert>) =>
  t.db
    .insert(schema.accountPerformance)
    .values({
      year: 2032,
      institution: "Inst",
      accountLabel: "acct",
      parentCategory: "Portfolio",
      performanceAccountId: acct,
      beginningBalance: "1000",
      totalContributions: "0",
      employerContributions: "0",
      distributions: "0",
      fees: "0",
      rollovers: "0",
      yearlyGainLoss: "0",
      endingBalance: "1000",
      ...v,
    })
    .returning({ id: schema.accountPerformance.id })
    .get().id;

const checksOf = async (id: number) =>
  (await t.caller.performance.computeSummary()).accountRows.find(
    (r) => r.id === id,
  )!;

beforeEach(async () => {
  t = await createTestCaller();
  acct = seedPerformanceAccount(t.db, {
    accountType: "brokerage",
    parentCategory: "Portfolio",
  });
});
afterEach(() => t.cleanup());

describe("accepting a gap", () => {
  it("quiets it with its reason while the gap is the one accepted; it returns when the gap changes", async () => {
    // Gain entered as 200 where the figures say 250: 50 unexplained.
    const id = insertRow({ endingBalance: "1250", yearlyGainLoss: "200" });
    await t.caller.performance.annotateAccount({
      id,
      accept: { kind: "unbalanced", note: "Provider's reported gain" },
    });
    let row = await checksOf(id);
    expect(row.checks).toEqual([
      { kind: "unbalanced", amount: 50, accepted: true },
    ]);
    expect(row.acceptedChecks.unbalanced).toMatchObject({
      amount: 50,
      note: "Provider's reported gain",
    });

    await t.caller.performance.updateAccount({ id, yearlyGainLoss: "190" });
    row = await checksOf(id);
    expect(row.checks[0]).toMatchObject({ amount: 60, accepted: false });
  });

  it("needs a reason, and a gap that exists", async () => {
    const id = insertRow({ endingBalance: "1250", yearlyGainLoss: "200" });
    await expect(
      t.caller.performance.annotateAccount({
        id,
        accept: { kind: "unbalanced", note: "  " },
      }),
    ).rejects.toThrow();
    await expect(
      t.caller.performance.annotateAccount({
        id,
        accept: { kind: "chain", note: "x" },
      }),
    ).rejects.toThrow(/nothing to accept/);
  });

  it("a transfer is accepted as this row's own rollover having no tracked other side", async () => {
    const id = insertRow({
      rollovers: "300",
      endingBalance: "1300",
    });
    await t.caller.performance.annotateAccount({
      id,
      accept: { kind: "transfers", note: "From an old plan we don't track" },
    });
    const row = await checksOf(id);
    expect(row.acceptedChecks.transfers!.amount).toBe(300);
    expect(row.checks).toEqual([
      { kind: "transfers", amount: 300, accepted: true },
    ]);
  });

  it("un-accepting brings it back", async () => {
    const id = insertRow({ endingBalance: "1250", yearlyGainLoss: "200" });
    await t.caller.performance.annotateAccount({
      id,
      accept: { kind: "unbalanced", note: "on purpose" },
    });
    await t.caller.performance.annotateAccount({ id, unaccept: "unbalanced" });
    expect((await checksOf(id)).checks[0]!.accepted).toBe(false);
  });
});

describe("notes and estimated marks", () => {
  it("saves a note and the marks (unknown names dropped, list order kept); empty note clears", async () => {
    const id = insertRow({});
    await t.caller.performance.annotateAccount({
      id,
      note: "Q3 statement; October from the balance",
      estimatedFields: ["endingBalance", "employeeContrib"],
    });
    let row = await checksOf(id);
    expect(row.note).toBe("Q3 statement; October from the balance");
    expect(row.estimatedFields).toEqual(["employeeContrib", "endingBalance"]);

    await t.caller.performance.annotateAccount({ id, note: "" });
    row = await checksOf(id);
    expect(row.note).toBeNull();
    expect(row.estimatedFields).toEqual(["employeeContrib", "endingBalance"]);
  });

  it("a snapshot's real balance clears the ending's estimate mark only", async () => {
    const id = insertRow({
      estimatedFields: ["employeeContrib", "endingBalance"],
    });
    seedSnapshot(t.db, "2032-06-30", [
      { performanceAccountId: acct, amount: "1100" },
    ]);
    await t.db.transaction((tx) =>
      refreshSnapshotYearDerivatives(tx as never, "2032-06-30", [
        { performanceAccountId: acct, amount: "1100" },
      ]),
    );
    const stored = t.db
      .select()
      .from(schema.accountPerformance)
      .where(eq(schema.accountPerformance.id, id))
      .get()!;
    expect(stored.endingBalance).toBe("1100.00");
    expect(stored.estimatedFields).toEqual(["employeeContrib"]);
  });
});
