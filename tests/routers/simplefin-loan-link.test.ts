/** A SimpleFIN feed as a mortgage's balance. Invented figures. */
import "./setup-mocks";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema-sqlite";
import {
  adminSession,
  createTestCaller,
  seedPerformanceAccount,
} from "./setup";
import {
  applyPullMapping,
  clearUnmappedPulledBalances,
} from "@/server/helpers/apply-pull-mapping";
import { applyLoanFeedBalances } from "@/server/helpers/loan-feed";
import { recomputeTodaySnapshotFromLocal } from "@/lib/simplefin/sync";
import { countsInLiveBalance, feedsLoan } from "@/lib/pure/simplefin-feeds";

const loanInput = {
  name: "Example Loan",
  isActive: true,
  interestRate: "0.03",
  termYears: 30,
  originalLoanAmount: "300000",
  firstPaymentDate: "2020-01-01",
  principalAndInterest: "1264.81",
  propertyValuePurchase: "350000",
};

let ctx: Awaited<ReturnType<typeof createTestCaller>>;
let loanId: number;
let feedId: number;
const raw = () => ctx.rawDb as never;
const loan = () =>
  ctx.db
    .select()
    .from(schema.mortgageLoans)
    .where(eq(schema.mortgageLoans.id, loanId))
    .get()!;
const feed = (id = feedId) =>
  ctx.db
    .select()
    .from(schema.simplefinAccounts)
    .where(eq(schema.simplefinAccounts.id, id))
    .get()!;
const addFeed = (name: string, lastBalance: string, extra = {}) =>
  ctx.db
    .insert(schema.simplefinAccounts)
    .values({
      externalAccountId: name,
      orgName: "Example Servicer",
      accountName: name,
      lastBalance,
      ...extra,
    })
    .returning()
    .get().id;
const pull = (apiBalance: number) =>
  applyPullMapping(raw(), {
    mapping: {
      localId: `mortgage:${loanId}:loanBalance`,
      localName: "Loan",
      remoteAccountId: "r",
      syncDirection: "pull",
      loanId,
      loanMapType: "loanBalance",
    },
    apiBalance,
    service: "actual",
    currentYear: 2026,
  });

beforeEach(async () => {
  ctx = await createTestCaller(adminSession);
  const created = await ctx.caller.mortgage.mortgageLoans.create(
    loanInput as never,
  );
  loanId = created!.id;
  feedId = addFeed("servicer", "-200000.50", {
    lastBalanceDate: new Date("2026-10-20T12:00:00Z"),
  });
});
afterEach(() => ctx.cleanup());

const link = () => ctx.caller.simplefin.setLoanLink({ id: feedId, loanId });

describe("linking a feed to a loan", () => {
  it("writes the balance positive, dated by the feed", async () => {
    await link();
    expect(Number(loan().apiBalance)).toBe(200000.5);
    expect(loan().apiBalanceDate).toBe("2026-10-20");
  });

  it("a feed unchecked earlier is included, or the link would do nothing", async () => {
    await ctx.caller.simplefin.setAccountIncluded({
      id: feedId,
      isIncluded: false,
    });
    await link();
    expect(feed().isIncluded).toBe(true);
    expect(Number(loan().apiBalance)).toBe(200000.5);
  });

  it("ends a tracked-account link", async () => {
    const perf = seedPerformanceAccount(ctx.db);
    ctx.db
      .update(schema.simplefinAccounts)
      .set({ linkedPerformanceAccountId: perf, linkedSubKey: "k" })
      .where(eq(schema.simplefinAccounts.id, feedId))
      .run();
    await link();
    expect(feed().linkedPerformanceAccountId).toBeNull();
    expect(feed().linkedSubKey).toBeNull();
  });

  it("linking a tracked account ends the loan link", async () => {
    await link();
    const perf = seedPerformanceAccount(ctx.db);
    await ctx.caller.simplefin.setAccountMapping({
      id: feedId,
      performanceAccountId: perf,
    });
    expect(feed().linkedLoanId).toBeNull();
    expect(loan().apiBalance).toBeNull();
  });

  it("one feed per loan", async () => {
    await link();
    const other = addFeed("other", "-1");
    await expect(
      ctx.caller.simplefin.setLoanLink({ id: other, loanId }),
    ).rejects.toThrow(/already reports/);
    expect(() =>
      ctx.db
        .update(schema.simplefinAccounts)
        .set({ linkedLoanId: loanId })
        .where(eq(schema.simplefinAccounts.id, other))
        .run(),
    ).toThrow();
  });

  it("unlinking always returns the loan to its schedule", async () => {
    await link();
    await ctx.caller.simplefin.setLoanLink({ id: feedId, loanId: null });
    expect(loan().apiBalance).toBeNull();
  });

  it("deleting the loan drops the link", async () => {
    await link();
    await ctx.caller.mortgage.mortgageLoans.delete({ id: loanId });
    expect(feed().linkedLoanId).toBeNull();
  });
});

describe("the budget app's pull", () => {
  it("leaves a loan with an included feed alone", async () => {
    await link();
    expect(await pull(-1)).toEqual({ applied: false });
    expect(Number(loan().apiBalance)).toBe(200000.5);
  });

  it("resumes when the feed is unchecked", async () => {
    await link();
    await ctx.caller.simplefin.setAccountIncluded({
      id: feedId,
      isIncluded: false,
    });
    expect(loan().apiBalance).toBeNull();
    expect((await pull(-199000)).applied).toBe(true);
    expect(Number(loan().apiBalance)).toBe(199000);
  });

  it("clearing unmapped balances keeps a feed's, even with no mappings", async () => {
    await link();
    await clearUnmappedPulledBalances(raw());
    expect(Number(loan().apiBalance)).toBe(200000.5);
  });
});

describe("a sync", () => {
  it("doesn't touch a loan whose feed errored or didn't answer", async () => {
    await link();
    ctx.db
      .update(schema.simplefinAccounts)
      .set({ lastBalance: "0" })
      .where(eq(schema.simplefinAccounts.id, feedId))
      .run();
    await applyLoanFeedBalances(raw(), new Set(["someone-else"]));
    expect(Number(loan().apiBalance)).toBe(200000.5);
  });
});

describe("the live total", () => {
  it("leaves a loan's feed out", async () => {
    addFeed("checking", "1000");
    await link();
    const r = await recomputeTodaySnapshotFromLocal(raw());
    expect(r.totalBalance).toBe(1000);
    expect(r.accountCount).toBe(1);
  });

  it("the rules", () => {
    const a = { linkedLoanId: 1, isIncluded: true };
    expect(feedsLoan(a)).toBe(true);
    expect(countsInLiveBalance(a)).toBe(false);
    expect(countsInLiveBalance({ ...a, linkedLoanId: null })).toBe(true);
    expect(feedsLoan({ ...a, isIncluded: false })).toBe(false);
  });
});

describe("link suggestions", () => {
  it("never relink a loan feed to a tracked account", async () => {
    await link();
    const r = await ctx.caller.simplefin.listAccounts();
    expect(r.find((a) => a.id === feedId)?.suggestion).toBeNull();
    await ctx.caller.simplefin.acceptLinkSuggestions({});
    expect(feed().linkedLoanId).toBe(loanId);
  });
});
