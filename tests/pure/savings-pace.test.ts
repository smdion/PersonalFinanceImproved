/** Saved this year vs the paycheck plan. Invented figures only. */
import { describe, it, expect } from "vitest";
import { savingsPace } from "@/lib/pure/savings-pace";

// A $26,000-a-year plan paid over 26 paychecks ($1,000 each), 20 paid so far.
const plan = { yearly: 26_000, remaining: 6_000, perContribution: 1_000 };

const account = (over: Partial<Parameters<typeof savingsPace>[0][number]>) => ({
  performanceAccountId: 1,
  label: "Alex 401k (Example)",
  recorded: 0,
  pending: 0,
  pendingEstimated: false,
  unposted: 0,
  plan,
  ...over,
});

describe("savingsPace", () => {
  it("counts a paycheck the feed hasn't posted yet as on its way", () => {
    const [r] = savingsPace([
      account({ recorded: 18_000, unposted: 1_000 }),
    ]).accounts;
    expect(r).toMatchObject({
      saved: 18_000,
      yearEnd: 25_000,
      status: "on_pace",
    });
  });

  it("compares saved with the plan through the latest contribution", () => {
    const [r] = savingsPace([
      account({ recorded: 17_000, pending: 3_000 }),
    ]).accounts;
    expect(r).toMatchObject({
      saved: 20_000,
      planYear: 26_000,
      planToDate: 20_000,
      status: "on_pace",
    });
  });

  it("allows one contribution's worth for a deposit that posts late, then calls it behind", () => {
    expect(
      savingsPace([account({ recorded: 19_000 })]).accounts[0]!.status,
    ).toBe("on_pace");
    expect(
      savingsPace([account({ recorded: 18_500 })]).accounts[0]!.status,
    ).toBe("behind");
  });

  it("estimates the year end as saved plus the rest of the year at today's rate", () => {
    // Saved less earlier in the year (a lower election): on pace now, short for the year.
    const [r] = savingsPace([account({ recorded: 18_400 })]).accounts;
    expect(r!.yearEnd).toBe(24_400);
  });

  it("says the plan is met once the year's plan is saved", () => {
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

  it("totals the household and flags estimated amounts", () => {
    const r = savingsPace([
      account({ recorded: 20_000 }),
      account({
        performanceAccountId: 2,
        plan: { yearly: 6_000, remaining: 1_000, perContribution: 500 },
        pending: 2_000,
        pendingEstimated: true,
      }),
    ]);
    expect(r.total).toMatchObject({
      saved: 22_000,
      planYear: 32_000,
      planToDate: 25_000,
      yearEnd: 29_000,
      estimated: true,
    });
  });
});
