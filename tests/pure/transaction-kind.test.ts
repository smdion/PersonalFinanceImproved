/** The kind a stored row is shown as. Invented rows only. */
import { describe, it, expect } from "vitest";
import {
  balanceAsOf,
  effectiveTransactionKind,
} from "@/lib/pure/transaction-kind";

const row = (description: string, amount: number) => ({
  amount,
  description,
  kindOverride: null,
});

describe("effectiveTransactionKind", () => {
  it("uses the built-in rules", () => {
    expect(
      effectiveTransactionKind("Vanguard", row("CASH", 500)),
    ).toMatchObject({
      kind: "contribution",
      source: "built_in",
      uncertain: false,
    });
  });

  it("keeps the kind ingest locked", () => {
    const k = effectiveTransactionKind("Example Bank", {
      ...row("Medical withdrawal", -10),
      kindOverride: "withdrawal",
    });
    expect(k).toMatchObject({
      kind: "withdrawal",
      source: "locked",
      uncertain: false,
    });
  });

  it("marks unmatched rows as a best guess", () => {
    expect(
      effectiveTransactionKind("Example Bank", row("ZZZ 123", 10)),
    ).toMatchObject({ kind: "other", source: "unmatched", uncertain: true });
  });

  it("applies a built-in direction fix (flipped plan contributions)", () => {
    expect(
      effectiveTransactionKind(
        "Fidelity Investments",
        row("contribution", -50),
      ),
    ).toMatchObject({ kind: "contribution", amount: 50, uncertain: true });
  });
});

describe("balanceAsOf", () => {
  const history = [
    { day: "2026-05-10", balance: 1000 },
    { day: "2026-05-20", balance: 2000 },
  ];
  it("uses the last balance on or before the day", () => {
    expect(balanceAsOf(history, "2026-05-10")).toBe(1000);
    expect(balanceAsOf(history, "2026-05-19")).toBe(1000);
    expect(balanceAsOf(history, "2026-05-25")).toBe(2000);
  });
  it("uses the earliest balance for older rows", () => {
    expect(balanceAsOf(history, "2026-04-01")).toBe(1000);
  });
  it("has nothing without history", () => {
    expect(balanceAsOf([], "2026-04-01")).toBeUndefined();
  });
});
