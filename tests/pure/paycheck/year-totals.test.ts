import { describe, expect, it } from "vitest";
import { calculatePaycheck } from "@/lib/pure/paycheck/per-check";
import { yearTotals } from "@/lib/pure/paycheck/year-totals";
import { PERSON_A_PAYCHECK_INPUT } from "../fixtures";

describe("yearTotals", () => {
  const r = calculatePaycheck({
    ...PERSON_A_PAYCHECK_INPUT,
    annualSalary: 300_000,
    bonusOverride: 20_000,
    bonusMonth: 3,
    bonusDayOfMonth: 15,
  });
  const rows = r.yearSchedule;
  const sum = (from: number, to: number, pick: (i: number) => number) => {
    let s = 0;
    for (let i = from; i <= to; i++) s += pick(i - 1);
    return Math.round(s * 100) / 100;
  };

  it("sums checks first through last, inclusive, each line on its own", () => {
    const t = yearTotals(rows, 3, 20);
    expect(t.net).toBe(sum(3, 20, (i) => rows[i]!.netPay));
    expect(t.fica).toBe(
      sum(3, 20, (i) => rows[i]!.ficaSS + rows[i]!.ficaMedicare),
    );
    expect(t.federal).toBe(sum(3, 20, (i) => rows[i]!.federalWithholding));
    expect(t.gross).toBe(sum(3, 20, (i) => rows[i]!.gross));
  });

  it("keeps the bonus check's own lines apart from regular pay", () => {
    const bonusRow = rows.findIndex((p) => p.bonusGross > 0) + 1;
    expect(bonusRow).toBeGreaterThan(0);
    const t = yearTotals(rows, bonusRow, bonusRow);
    expect(t.bonusGross).toBe(20_000);
    expect(t.bonusFederal).toBe(rows[bonusRow - 1]!.bonusWithholding);
    expect(t.gross).toBe(rows[bonusRow - 1]!.gross);
    expect(yearTotals(rows, 1, bonusRow - 1).bonusGross).toBe(0);
  });

  it("an empty range (none paid yet) is all zeros", () => {
    const t = yearTotals(rows, 1, 0);
    expect(Object.values(t).every((v) => v === 0)).toBe(true);
  });
});
