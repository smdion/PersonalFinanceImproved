/** Deposits vs the paycheck setup. Invented figures only. */
import { describe, it, expect } from "vitest";
import { checkDeposits } from "@/lib/pure/deposit-check";

const every14 = (n: number, amount: number) =>
  Array.from({ length: n }, (_, i) => ({
    posted: new Date(Date.UTC(2026, 0, 2 + i * 14)).toISOString().slice(0, 10), // lint-violation-ok: fixture UTC day keys
    amount,
  }));

describe("checkDeposits", () => {
  it("sums a payday's per-fund rows and finds the yearly pace", () => {
    const rows = every14(4, 100).flatMap((d) => [d, { ...d, amount: 50 }]);
    const c = checkDeposits(rows, 3900, true);
    expect(c).toMatchObject({
      paydays: 4,
      typical: 150,
      everyDays: 14,
      verdict: "matches",
    });
    expect(c.observedAnnual).toBeCloseTo((150 * 365) / 14, 2);
    expect(c.recent).toHaveLength(3);
  });

  it("flags a pace well off the setup", () => {
    expect(checkDeposits(every14(4, 100), 5000, true).verdict).toBe("lower");
    expect(checkDeposits(every14(4, 300), 5000, true).verdict).toBe("higher");
  });

  it("flags deposits with no setup, and a setup with no deposits", () => {
    expect(checkDeposits(every14(4, 100), null, true).verdict).toBe("no_setup");
    expect(checkDeposits([], 5000, true).verdict).toBe("no_deposits");
  });

  it("waits for enough paydays, and can't judge a balance-only feed", () => {
    expect(checkDeposits(every14(2, 100), 5000, true).verdict).toBe("too_few");
    expect(checkDeposits(every14(4, 100), 5000, false).verdict).toBe("unknown");
  });
});
