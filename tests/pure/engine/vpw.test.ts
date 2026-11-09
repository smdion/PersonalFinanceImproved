/**
 * VPW: every published table cell to the tenth, the younger spouse's age,
 * the 10% cap (and ages at or past the end age), the stock share from the
 * glide path.
 */
import { describe, it, expect } from "vitest";
import { applyVpw, vpwRate } from "@/lib/pure/engine/spending-strategies/vpw";
import { initialCrossYearState } from "@/lib/pure/engine/spending-strategy";
import { getStrategyDefaults } from "@/lib/config/withdrawal-strategies";
import { VPW_STOCK_SHARES, VPW_TABLE } from "../../fixtures/vpw-table";

const defaults = getStrategyDefaults("vpw");
const input = (over: Partial<Parameters<typeof applyVpw>[1]> = {}) => ({
  projectedExpenses: 0,
  portfolioBalance: 1_000_000,
  effectiveInflation: 0.025,
  cpiInflation: 0.025,
  hasBudgetOverride: false,
  yearIndex: 0,
  age: 65,
  crossYearState: initialCrossYearState(),
  ...over,
});

describe("vpwRate", () => {
  it("reproduces every published table cell to the tenth", () => {
    for (const [n, cells] of VPW_TABLE)
      VPW_STOCK_SHARES.forEach((stocks, j) => {
        const r = stocks * 0.05 + (1 - stocks) * 0.019;
        expect(Math.round(vpwRate(r, n) * 1000) / 10).toBe(cells[j]);
      });
  });

  it("the last withdrawal takes everything; none left takes everything", () => {
    expect(vpwRate(0.03, 1)).toBeCloseTo(1);
    expect(vpwRate(0.03, 0)).toBe(1);
    expect(vpwRate(0, 4)).toBe(0.25);
  });
});

describe("applyVpw", () => {
  it("65 at 30/70 withdraws 4.4% — the wiki's own example", () => {
    const r = applyVpw(defaults, input({ stockShare: 0.3 }));
    expect(r.projectedExpenses / 1_000_000).toBeCloseTo(0.0441, 3);
    expect(r.amountKind).toBe("portfolio_withdrawal");
  });

  it("a couple uses the younger spouse's age", () => {
    const older = applyVpw(defaults, input({ age: 70, stockShare: 0.6 }));
    const couple = applyVpw(
      defaults,
      input({ age: 70, youngestAge: 62, stockShare: 0.6 }),
    );
    expect(couple.projectedExpenses).toBeLessThan(older.projectedExpenses);
    expect(couple.projectedExpenses / 1_000_000).toBeCloseTo(0.048, 3);
  });

  it("stops growing at 10% — including at and past the end age", () => {
    for (const age of [89, 99, 100, 104]) {
      const r = applyVpw(defaults, input({ age, stockShare: 0.6 }));
      expect(r.projectedExpenses).toBe(100_000);
      expect(r.action).toBe("vpw_cap");
    }
  });

  it("without a glide path, the default stock share (60%)", () => {
    const r = applyVpw(defaults, input({ age: 65 }));
    expect(r.projectedExpenses / 1_000_000).toBeCloseTo(0.0496, 3);
  });
});
