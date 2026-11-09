/**
 * Answer key, withdrawals taken from balances (ENG-18; v0.10.5 overnight
 * batch). Arithmetic: money is conserved. With a 0% return, what an
 * account ends the year with is what it started with less what was drawn,
 * and what was drawn less its tax is the year's need. Every figure is
 * worked by hand first, never read from `src/`. Invented households only.
 *
 * Tax: Rev. Proc. 2025-32 (RP25, 2026) § 4.01 Table 3 (Single: 10% to
 * 12,400, 12% to 50,400) and § 4.14(1) ($16,100). A brokerage sale at full
 * basis has no gain (IRC 1001(a)). A Traditional IRA draw past 59½ is
 * ordinary income with no additional tax (IRC 72(t)(2)(A)(i)).
 */
import { describe, it } from "vitest";
import { ledgerRow } from "../../fixtures/answer-key";
import { retiredYear } from "../../fixtures/answer-key-household";

const balanceOf = (
  r: ReturnType<typeof retiredYear>,
  taxType: "preTax" | "afterTax",
) =>
  r.individualAccountBalances
    .filter((a) => a.taxType === taxType)
    .reduce((s, a) => s + a.balance, 0);

describe("answer key: withdrawals leave the balances they came from", () => {
  it("engine/ENG18-1 [ENG-18] a brokerage at full basis: the need comes out untaxed", () => {
    // Single, born 1962 (64 in 2026: no 65+ deduction), no Social
    // Security, a $500,000 brokerage with $500,000 basis, spending
    // $40,000. The sale has no gain, so no tax: draw 40,000, the
    // brokerage ends at 460,000.00.
    const r = retiredYear(
      {
        status: "Single",
        people: [{ birthYear: 1962 }],
        brokerage: { balance: 500_000, basis: 500_000 },
        spending: 40_000,
        endYear: 2027,
      },
      2026,
    );
    ledgerRow(
      {
        withdrawal: r.totalWithdrawal,
        tax: r.taxCost,
        brokerage: balanceOf(r, "afterTax"),
      },
      { withdrawal: 40_000, tax: 0, brokerage: 460_000 },
      { row: 0, balanceKeys: ["brokerage"] },
    );
  });

  it("engine/ENG18-2 [ENG-18] a Traditional IRA: the draw grossed up for its own tax", () => {
    // Single, born 1962, a $500,000 Traditional IRA, spending $40,000.
    // The draw W nets the need: W − tax(W) = 40,000. In the 12% band,
    // tax(W) = 1,240 + 12% × (W − 28,500), so W − 1,240 − 0.12 W + 3,420
    // = 40,000 → 0.88 W = 37,820 → W = 42,977.27. TI 26,877.27 (inside
    // 12,400-50,400). Tax 1,240 + 12% × 14,477.27 = 2,977.27; W − tax =
    // 40,000.00. The IRA ends at 500,000 − 42,977.27 = 457,022.73.
    const r = retiredYear(
      {
        status: "Single",
        people: [{ birthYear: 1962 }],
        traditionalIra: 500_000,
        spending: 40_000,
        endYear: 2027,
      },
      2026,
    );
    ledgerRow(
      {
        withdrawal: r.totalWithdrawal,
        tax: r.taxCost,
        net: r.totalWithdrawal - r.taxCost,
        ira: balanceOf(r, "preTax"),
      },
      { withdrawal: 42_977.27, tax: 2_977.27, net: 40_000, ira: 457_022.73 },
      { row: 0, balanceKeys: ["ira"] },
    );
  });
});
