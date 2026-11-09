/**
 * Merging a re-added SimpleFIN account by hand: the candidates settings
 * shows, the owner-confirmed merge, every refusal, the permission and demo
 * gates. Invented accounts only.
 */
import "./setup-mocks";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import {
  createTestCaller,
  createViewerSessionWithPermissions,
  seedPerformanceAccount,
} from "./setup";

const ORG = "Example Retirement Co";
const OLD_SEEN = new Date("2026-11-06T08:49:00Z");
const LATEST = new Date("2026-11-06T09:04:00Z");

describe("simplefin.mergeReaddedAccount", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  let perf: number;
  let oldId: number;
  let copyId: number;

  const feed = (values: {
    externalAccountId: string;
    accountName: string;
    lastSeenAt: Date;
    orgName?: string;
    linkedPerformanceAccountId?: number;
    linkedLoanId?: number;
    lastBalance?: string;
    isIncluded?: boolean;
  }) =>
    ctx.db
      .insert(sqliteSchema.simplefinAccounts)
      .values({ orgName: ORG, lastBalance: "100", ...values })
      .returning()
      .get().id;

  const feeds = () =>
    ctx.db
      .select()
      .from(sqliteSchema.simplefinAccounts)
      .orderBy(asc(sqliteSchema.simplefinAccounts.id))
      .all();

  beforeEach(async () => {
    ctx = await createTestCaller();
    perf = seedPerformanceAccount(ctx.db, {
      institution: ORG,
      accountType: "401k",
      accountLabel: "Example 401k",
    });
    oldId = feed({
      externalAccountId: "old-plan",
      accountName: "Example 401(k) Plan (1111)",
      lastSeenAt: OLD_SEEN,
      linkedPerformanceAccountId: perf,
      lastBalance: "50000",
    });
    // Renamed by the re-add: the sync's rule won't pair it, the owner can.
    copyId = feed({
      externalAccountId: "new-plan",
      accountName: "Example 401(k) Savings Plan (1111)",
      lastSeenAt: LATEST,
      lastBalance: "50500",
    });
    ctx.db
      .insert(sqliteSchema.simplefinAccountBalances)
      .values({
        simplefinAccountId: copyId,
        balanceDate: LATEST,
        balance: "50500",
      })
      .run();
  });
  afterEach(() => ctx.cleanup());

  it("lists the older account at the same institution as a candidate", async () => {
    expect(await ctx.caller.simplefin.listReaddedAccounts()).toEqual([
      {
        copyId,
        candidates: [
          {
            id: oldId,
            accountName: "Example 401(k) Plan (1111)",
            exactName: false,
            linked: true,
          },
        ],
      },
    ]);
  });

  it("merges at once: one row, its link kept, the copy's id, balance and history", async () => {
    const out = await ctx.caller.simplefin.mergeReaddedAccount({
      copyId,
      keepId: oldId,
    });
    expect(out.ok).toBe(true);
    const rows = feeds();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: oldId,
      externalAccountId: "new-plan",
      accountName: "Example 401(k) Savings Plan (1111)",
      linkedPerformanceAccountId: perf,
      isIncluded: true,
    });
    expect(Number(rows[0]!.lastBalance)).toBe(50500);
    const balances = ctx.db
      .select()
      .from(sqliteSchema.simplefinAccountBalances)
      .all();
    expect(balances.map((b) => b.simplefinAccountId)).toEqual([oldId]);
    expect(out.accountCount).toBe(1);
    expect(out.totalBalance).toBe(50500);
    expect(await ctx.caller.simplefin.listReaddedAccounts()).toEqual([]);
  });

  it("counts the merged account when the old one had been excluded", async () => {
    ctx.db
      .update(sqliteSchema.simplefinAccounts)
      .set({ isIncluded: false })
      .where(eq(sqliteSchema.simplefinAccounts.id, oldId))
      .run();
    const out = await ctx.caller.simplefin.mergeReaddedAccount({
      copyId,
      keepId: oldId,
    });
    expect(feeds()[0]).toMatchObject({ id: oldId, isIncluded: true });
    expect(out.totalBalance).toBe(50500);
  });

  it("refuses a pair that isn't one, changing nothing", async () => {
    const other = feed({
      externalAccountId: "bank-1",
      accountName: "Checking",
      orgName: "Example Bank",
      lastSeenAt: OLD_SEEN,
    });
    const live = feed({
      externalAccountId: "still-here",
      accountName: "Example IRA (2222)",
      lastSeenAt: LATEST,
    });
    const linkedCopy = feed({
      externalAccountId: "linked-new",
      accountName: "Example HSA (3333)",
      lastSeenAt: LATEST,
      linkedPerformanceAccountId: perf,
    });
    const excluded = feed({
      externalAccountId: "excluded-new",
      accountName: "Example Brokerage (4444)",
      lastSeenAt: LATEST,
      isIncluded: false,
    });
    const stale = feed({
      externalAccountId: "stale-new",
      accountName: "Example Cash (5555)",
      lastSeenAt: OLD_SEEN,
    });
    const sideBySide = feed({
      externalAccountId: "side-by-side",
      accountName: "Example Roth (6666)",
      lastSeenAt: LATEST,
    });
    ctx.db
      .insert(sqliteSchema.simplefinAccountBalances)
      .values({
        simplefinAccountId: sideBySide,
        balanceDate: new Date("2026-10-01T00:00:00Z"),
        balance: "10",
        createdAt: new Date("2026-10-01T00:00:00Z"),
      })
      .run();
    const loan = await ctx.caller.mortgage.mortgageLoans.create({
      name: "Example Loan",
      isActive: true,
      interestRate: "0.03",
      termYears: 30,
      originalLoanAmount: "300000",
      firstPaymentDate: "2020-01-01",
      principalAndInterest: "1264.81",
      propertyValuePurchase: "350000",
    } as never);
    const loanFeed = feed({
      externalAccountId: "servicer-old",
      accountName: "Example Mortgage (7777)",
      lastSeenAt: OLD_SEEN,
      linkedLoanId: loan!.id,
      lastBalance: "-200000",
    });
    const before = feeds();
    for (const [input, message] of [
      [{ copyId, keepId: copyId }, /into itself/],
      [{ copyId, keepId: other }, /same institution/],
      [{ copyId: linkedCopy, keepId: oldId }, /Unlink the new account/],
      [{ copyId, keepId: live }, /answered the latest sync/],
      [{ copyId, keepId: 9999 }, /not found/],
      [{ copyId: excluded, keepId: oldId }, /Include the new account/],
      [{ copyId: stale, keepId: oldId }, /didn't answer the latest sync/],
      [{ copyId: sideBySide, keepId: oldId }, /two accounts/],
      [{ copyId, keepId: loanFeed }, /owes money/],
    ] as const)
      await expect(
        ctx.caller.simplefin.mergeReaddedAccount(input),
      ).rejects.toThrow(message);
    expect(feeds()).toEqual(before);
  });

  it("is admin-only", async () => {
    const syncer = await createTestCaller(
      createViewerSessionWithPermissions(["sync"]),
    );
    const admin = await createTestCaller();
    try {
      await expect(
        syncer.caller.simplefin.mergeReaddedAccount({ copyId, keepId: oldId }),
      ).rejects.toThrow(/Admin access required/);
      // A separate database: the procedure is reached, the pair not found.
      await expect(
        admin.caller.simplefin.mergeReaddedAccount({ copyId, keepId: oldId }),
      ).rejects.toThrow(/not found/);
    } finally {
      syncer.cleanup();
      admin.cleanup();
    }
  });

  it("is blocked in demo mode", async () => {
    // The guard reads DEMO_ONLY when the tRPC module loads.
    vi.stubEnv("DEMO_ONLY", "true");
    vi.resetModules();
    const demo = await (await import("./setup")).createTestCaller();
    try {
      await expect(
        demo.caller.simplefin.mergeReaddedAccount({ copyId, keepId: oldId }),
      ).rejects.toThrow(/read-only demo/);
    } finally {
      demo.cleanup();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
