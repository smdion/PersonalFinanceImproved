/** Saved this year vs the paycheck plan. Invented figures only. */
import { describe, it, expect } from "vitest";
import { savingsPace } from "@/lib/pure/savings-pace";

const plan = (employee: number, employer: number) => ({
  employeePreTax: employee,
  employeeRoth: 0,
  employeeOther: 0,
  employer,
  employerRoth: 0,
});

const account = (over: Partial<Parameters<typeof savingsPace>[0][number]>) => ({
  performanceAccountId: 1,
  label: "Alex 401k (Example)",
  recorded: 0,
  pending: 0,
  pendingEstimated: false,
  plan: plan(24_000, 12_000),
  ...over,
});

describe("savingsPace", () => {
  // 2026-07-02 is 183 days in: about half the year.
  const today = "2026-07-02";

  it("compares saved with the plan pro-rated to today", () => {
    const r = savingsPace(
      [account({ recorded: 15_000, pending: 3_000 })],
      today,
    );
    expect(r.accounts[0]).toMatchObject({
      saved: 18_000,
      planYear: 36_000,
      status: "on_pace",
    });
    expect(r.accounts[0]!.planToDate).toBeCloseTo(36_000 * (183 / 365), 0);
  });

  it("allows half a month of slack for paydays, then calls it behind", () => {
    expect(
      savingsPace([account({ recorded: 16_600 })], today).accounts[0]!.status,
    ).toBe("on_pace");
    expect(
      savingsPace([account({ recorded: 14_000 })], today).accounts[0]!.status,
    ).toBe("behind");
  });

  it("says the goal is met once the year's plan is saved", () => {
    expect(
      savingsPace([account({ recorded: 36_000 })], today).accounts[0]!.status,
    ).toBe("met");
  });

  it("keeps accounts with savings but no plan, and drops empty ones", () => {
    const r = savingsPace(
      [
        account({ performanceAccountId: 2, plan: null, recorded: 7_000 }),
        account({ performanceAccountId: 3, plan: null }),
      ],
      today,
    );
    expect(r.accounts.map((a) => [a.performanceAccountId, a.status])).toEqual([
      [2, "no_plan"],
    ]);
  });

  it("totals the household and flags estimated amounts", () => {
    const r = savingsPace(
      [
        account({ recorded: 18_000 }),
        account({
          performanceAccountId: 2,
          plan: plan(6_000, 0),
          pending: 2_000,
          pendingEstimated: true,
        }),
      ],
      today,
    );
    expect(r.total).toMatchObject({
      saved: 20_000,
      planYear: 42_000,
      estimated: true,
    });
  });
});
