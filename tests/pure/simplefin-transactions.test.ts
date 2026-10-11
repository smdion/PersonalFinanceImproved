/**
 * SimpleFIN investment-transaction classification. All rows below are
 * invented examples in each institution's format — no real account data.
 */
import { describe, it, expect } from "vitest";
import {
  classifySimplefinTransaction,
  summarizeAccountFlows,
  type SimplefinTransactionInput,
} from "@/lib/pure/simplefin-transactions";

const day = (iso: string) => Date.parse(`${iso}T12:00:00Z`) / 1000;
const tx = (
  iso: string,
  amount: number,
  description: string,
): SimplefinTransactionInput => ({ posted: day(iso), amount, description });

describe("classifySimplefinTransaction", () => {
  it("Vanguard: CASH rows are money crossing the boundary, by sign", () => {
    expect(
      classifySimplefinTransaction("Vanguard", tx("2026-05-01", 500, "CASH"))
        .kind,
    ).toBe("contribution");
    expect(
      classifySimplefinTransaction("Vanguard", tx("2026-05-02", -500, "CASH"))
        .kind,
    ).toBe("withdrawal");
  });

  it("Vanguard: settlement-fund rows are sweeps and fund rows are trades", () => {
    expect(
      classifySimplefinTransaction(
        "Vanguard",
        tx("2026-05-01", -500, "VANGUARD FEDERAL MONEY MARKET INVESTOR CL"),
      ).kind,
    ).toBe("sweep");
    expect(
      classifySimplefinTransaction(
        "Vanguard",
        tx(
          "2026-05-03",
          -500.05,
          "VANGUARD TARGET RETIREMENT 2050 INVESTOR CL",
        ),
      ).kind,
    ).toBe("trade");
  });

  it("Fidelity workplace plan: typed descriptions", () => {
    const f = (amount: number, d: string) =>
      classifySimplefinTransaction(
        "Fidelity Investments",
        tx("2026-05-01", amount, d),
      ).kind;
    expect(f(120, "contribution")).toBe("contribution");
    expect(f(15, "dividend")).toBe("dividend");
    expect(f(-2.5, "fees")).toBe("fee");
    expect(f(0.4, "realizedGainLoss")).toBe("gain_loss");
  });

  it("Fidelity: a contribution sent with a flipped sign still counts as money in, and is flagged", () => {
    const c = classifySimplefinTransaction(
      "Fidelity Investments",
      tx("2026-05-01", -120, "contribution"),
    );
    expect(c).toEqual({
      kind: "contribution",
      amount: 120,
      ruleId: "fidelity-contribution",
      needsReview: true,
    });
  });

  it("Fidelity HSA: debit-card purchases are withdrawals; core-account moves stay inside", () => {
    const f = (amount: number, d: string) =>
      classifySimplefinTransaction(
        "Fidelity Investments",
        tx("2026-05-01", amount, d),
      ).kind;
    expect(f(-80, "DEBIT CARD PURCHASE EXAMPLE CLINIC (Cash)")).toBe(
      "withdrawal",
    );
    expect(
      f(
        80,
        "REDEMPTION FROM CORE ACCOUNT FIDELITY GOVERNMENT CASH RESERVES (FDRXX)",
      ),
    ).toBe("sweep");
    expect(
      f(-12, "REINVESTMENT FIDELITY HEALTH SAVINGS FUND (FHLSX) (Cash)"),
    ).toBe("trade");
    expect(
      f(12, "DIVIDEND RECEIVED FIDELITY HEALTH SAVINGS FUND (FHLSX) (Cash)"),
    ).toBe("dividend");
  });

  it("Voya: positive rows are contributions; debits small relative to the balance are fees", () => {
    const v = (amount: number, accountBalance?: number) =>
      classifySimplefinTransaction(
        "Voya Financial",
        tx("2026-05-01", amount, "LifePath Index 2050 Fund"),
        { accountBalance },
      );
    expect(v(300, 50_000).kind).toBe("contribution");
    // 0.1% of the balance is the cutoff, so "small" scales with the account.
    expect(v(-40, 50_000).kind).toBe("fee");
    expect(v(-40, 5_000)).toMatchObject({ kind: "other", needsReview: true });
    // Without a known balance a debit can't be judged — flagged, not guessed.
    expect(v(-1.25)).toMatchObject({ kind: "other", needsReview: true });
  });

  it("an unknown institution falls back to keywords, then to other (never dropped)", () => {
    expect(
      classifySimplefinTransaction(
        "Example Bank",
        tx("2026-05-01", 100, "EMPLOYEE CONTRIBUTION"),
      ).kind,
    ).toBe("contribution");
    expect(
      classifySimplefinTransaction(
        "Example Bank",
        tx("2026-05-01", 3, "INTEREST PAID"),
      ).kind,
    ).toBe("interest");
    expect(
      classifySimplefinTransaction(
        "Example Bank",
        tx("2026-05-01", 7, "MYSTERY ROW"),
      ),
    ).toEqual({
      kind: "other",
      amount: 7,
      ruleId: null,
      needsReview: true,
    });
  });

  it("never matches on account names — rules see only institution and description", () => {
    // A description that happens to contain an account-ish word must not change the outcome.
    expect(
      classifySimplefinTransaction("Vanguard", tx("2026-05-01", 500, "CASH"))
        .ruleId,
    ).toBe("vanguard-cash");
  });
});

describe("summarizeAccountFlows", () => {
  it("Vanguard: a deposit, its sweep and the fund purchase count as one contribution", () => {
    const s = summarizeAccountFlows("Vanguard", [
      tx("2026-05-01", 500, "CASH"),
      tx("2026-05-01", -500, "VANGUARD FEDERAL MONEY MARKET INVESTOR CL"),
      tx("2026-05-04", -500.05, "VANGUARD TARGET RETIREMENT 2050 INVESTOR CL"),
      tx("2026-05-05", 500.05, "VANGUARD FEDERAL MONEY MARKET INVESTOR CL"),
      tx("2026-05-31", 0.03, "VANGUARD FEDERAL MONEY MARKET INVESTOR CL"),
    ]);
    expect(s.contributions).toBe(500);
    expect(s.withdrawals).toBe(0);
    expect(s.netFlow).toBe(500);
    expect(s.netFlowByDate).toEqual({ "2026-05-01": 500 });
  });

  it("Vanguard: an IRA-to-IRA conversion is a withdrawal on one side and a contribution on the other", () => {
    const traditional = summarizeAccountFlows("Vanguard", [
      tx("2026-05-01", 500, "CASH"),
      tx("2026-05-04", -500, "CASH"),
    ]);
    const roth = summarizeAccountFlows("Vanguard", [
      tx("2026-05-04", 500, "CASH"),
    ]);
    expect(traditional.netFlow).toBe(0);
    expect(roth.netFlow).toBe(500);
  });

  it("Fidelity: one payday split across five funds collapses into one dated deposit", () => {
    const s = summarizeAccountFlows("Fidelity Investments", [
      tx("2026-05-08", 290, "contribution"),
      tx("2026-05-08", 60, "contribution"),
      tx("2026-05-08", 60, "contribution"),
      tx("2026-05-08", 55, "contribution"),
      tx("2026-05-08", 35, "contribution"),
      tx("2026-05-29", 20, "dividend"),
      tx("2026-05-29", -1.5, "fees"),
      tx("2026-05-29", 0.2, "realizedGainLoss"),
    ]);
    expect(s.netFlowByDate).toEqual({ "2026-05-08": 500 });
    expect(s.dividends).toBe(20);
    expect(s.fees).toBe(1.5);
    expect(s.netFlow).toBe(500);
  });

  it("HSA: medical spending is a withdrawal and a refund reduces it", () => {
    const s = summarizeAccountFlows("Fidelity Investments", [
      tx("2026-05-10", -80, "DEBIT CARD PURCHASE EXAMPLE CLINIC (Cash)"),
      tx(
        "2026-05-10",
        80,
        "REDEMPTION FROM CORE ACCOUNT FIDELITY GOVERNMENT CASH RESERVES (FDRXX)",
      ),
      tx("2026-05-12", 20, "DEBIT CARD PURCHASE EXAMPLE CLINIC (Cash)"),
    ]);
    expect(s.withdrawals).toBe(60);
    expect(s.netFlow).toBe(-60);
  });

  it("Fidelity: paydays with flipped signs still total as deposits", () => {
    const s = summarizeAccountFlows("Fidelity Investments", [
      tx("2026-05-08", -300, "contribution"),
      tx("2026-05-08", -200, "contribution"),
      tx("2026-05-22", 300, "contribution"),
      tx("2026-05-22", 200, "contribution"),
    ]);
    expect(s.netFlowByDate).toEqual({ "2026-05-08": 500, "2026-05-22": 500 });
    expect(s.contributions).toBe(1000);
    expect(s.needsReviewCount).toBe(2);
  });

  it("counts rows that need review", () => {
    const s = summarizeAccountFlows(
      "Voya Financial",
      [
        tx("2026-05-08", 300, "LifePath Index 2050 Fund"),
        tx("2026-05-09", -900, "LifePath Index 2050 Fund"),
      ],
      { accountBalance: 50_000 },
    );
    expect(s.contributions).toBe(300);
    expect(s.needsReviewCount).toBe(1);
  });
});
