/** Saved this year at today's setup. Invented figures only. */
import { describe, it, expect } from "vitest";
import { savingsPace } from "@/lib/pure/savings-pace";

// A $26,000-a-year setup, $6,000 of it still to come this year.
const plan = { yearly: 26_000, remaining: 6_000 };

const account = (over: Partial<Parameters<typeof savingsPace>[0][number]>) => ({
  performanceAccountId: 1,
  label: "Alex 401k (Example)",
  recorded: 0,
  pending: 0,
  pendingEstimated: false,
  unposted: 0,
  latest: "matches" as const,
  plan,
  ...over,
});

describe("savingsPace", () => {
  it("is on pace when the latest contribution matches today's setup, whatever was saved earlier", () => {
    // Saved less earlier in the year under an old setup Ledgr has no record of.
    const [r] = savingsPace([
      account({ recorded: 15_000, unposted: 1_000 }),
    ]).accounts;
    expect(r).toMatchObject({
      saved: 15_000,
      planYear: 26_000,
      yearEnd: 22_000,
      status: "on_pace",
    });
  });

  it("flags a latest contribution that differs, or none arriving", () => {
    expect(
      savingsPace([account({ recorded: 9_000, latest: "differs" })])
        .accounts[0]!.status,
    ).toBe("differs");
    expect(
      savingsPace([account({ recorded: 9_000, latest: "none" })]).accounts[0]!
        .status,
    ).toBe("no_recent");
  });

  it("calls a balance-only account estimated, and a full year saved met", () => {
    expect(
      savingsPace([
        account({ latest: null, pending: 500, pendingEstimated: true }),
      ]).accounts[0]!.status,
    ).toBe("estimated");
    expect(
      savingsPace([account({ recorded: 26_000 })]).accounts[0]!.status,
    ).toBe("met");
  });

  it("keeps accounts with savings but no plan, and drops empty ones", () => {
    const r = savingsPace([
      account({ performanceAccountId: 2, plan: null, recorded: 7_000 }),
      account({ performanceAccountId: 3, plan: null }),
    ]);
    expect(r.accounts.map((a) => [a.performanceAccountId, a.status])).toEqual([
      [2, "no_plan"],
    ]);
  });

  it("totals the household; on pace only when every checked account is", () => {
    const r = savingsPace([
      account({ recorded: 20_000 }),
      account({
        performanceAccountId: 2,
        plan: { yearly: 6_000, remaining: 1_000 },
        latest: null,
        pending: 2_000,
        pendingEstimated: true,
      }),
    ]);
    expect(r.total).toMatchObject({
      saved: 22_000,
      planYear: 32_000,
      yearEnd: 29_000,
      status: "on_pace",
      estimated: true,
    });
    expect(
      savingsPace([
        account({}),
        account({ performanceAccountId: 2, latest: "differs" }),
      ]).total.status,
    ).toBe("differs");
  });
});
