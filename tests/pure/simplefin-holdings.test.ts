/** SimpleFIN holdings → securities and observations. Invented examples only. */
import { describe, it, expect } from "vitest";
import {
  inferSecurityKind,
  securityIdentity,
  hasInvestedHoldings,
  planHoldingObservations,
  type HoldingInput,
} from "@/lib/pure/simplefin-holdings";

const h = (
  symbol: string,
  description: string,
  shares: number,
  marketValue: number | null = null,
): HoldingInput => ({
  symbol,
  description,
  shares,
  marketValue,
  costBasisPerShare: null,
});

describe("inferSecurityKind", () => {
  it("recognises cash-like positions by description", () => {
    expect(
      inferSecurityKind("EXMXX", "Example Federal Money Market Fund"),
    ).toBe("money_market");
    expect(inferSecurityKind("", "EXAMPLE CASH PLUS (Settlement fund)")).toBe(
      "money_market",
    );
  });
  it("treats a holding with no symbol as a plan-only fund", () => {
    expect(inferSecurityKind("", "Example Target 2050 Trust")).toBe(
      "plan_fund",
    );
  });
  it("recognises the mutual-fund ticker convention, otherwise waits for validation", () => {
    expect(inferSecurityKind("EXMPX", "Example Index Fund")).toBe(
      "mutual_fund",
    );
    expect(inferSecurityKind("EXMP", "Example ETF")).toBe("other");
  });
});

describe("securityIdentity", () => {
  it("never trusts a raw symbol alone — identity is institution + description", () => {
    const a = securityIdentity(
      "Bank A",
      h("ABCD", "Example International Fund", 1),
    );
    const b = securityIdentity(
      "Bank B",
      h("ABCD", "Example International Fund", 1),
    );
    expect(a.key).not.toBe(b.key);
    expect(a.sourceSymbol).toBe("ABCD");
  });
});

describe("hasInvestedHoldings", () => {
  it("ignores accounts holding only cash-like positions", () => {
    expect(
      hasInvestedHoldings([h("", "Example Cash Plus (Settlement fund)", 100)]),
    ).toBe(false);
    expect(hasInvestedHoldings([h("EXMPX", "Example Index Fund", 1)])).toBe(
      true,
    );
    expect(hasInvestedHoldings(null)).toBe(false);
  });
});

describe("planHoldingObservations", () => {
  const inst = "Example Brokerage";
  const key = (d: string) => securityIdentity(inst, h("", d, 0)).key;

  it("records every reported holding", () => {
    const plan = planHoldingObservations(
      inst,
      [h("EXMPX", "Fund A", 10, 1000)],
      new Map(),
    );
    expect(plan).toEqual({
      status: "ok",
      rows: [
        {
          key: key("Fund A"),
          shares: 10,
          marketValue: 1000,
          costBasisPerShare: null,
        },
      ],
    });
  });

  it("records a previously held fund that disappeared as 0 shares (sold)", () => {
    const plan = planHoldingObservations(
      inst,
      [h("EXMPX", "Fund A", 10, 1000)],
      new Map([
        [key("Fund A"), 8],
        [key("Fund B"), 5],
      ]),
    );
    expect(plan.status).toBe("ok");
    if (plan.status === "ok") {
      expect(plan.rows.find((r) => r.key === key("Fund B"))).toMatchObject({
        shares: 0,
      });
    }
  });

  it("treats an empty list as unknown when something was held before (never 'sold everything')", () => {
    expect(
      planHoldingObservations(inst, [], new Map([[key("Fund A"), 8]])),
    ).toEqual({
      status: "unknown",
      reason: "no_holdings_reported",
    });
    expect(
      planHoldingObservations(inst, null, new Map([[key("Fund A"), 8]])),
    ).toEqual({
      status: "unknown",
      reason: "no_holdings_reported",
    });
  });

  it("an empty list for an account that never held anything records nothing", () => {
    expect(planHoldingObservations(inst, [], new Map())).toEqual({
      status: "ok",
      rows: [],
    });
  });

  it("adds up the same fund reported twice", () => {
    const plan = planHoldingObservations(
      inst,
      [h("EXMPX", "Fund A", 10, 1000), h("EXMPX", "Fund A", 2.5, 250)],
      new Map(),
    );
    expect(plan.status === "ok" && plan.rows).toEqual([
      {
        key: key("Fund A"),
        shares: 12.5,
        marketValue: 1250,
        costBasisPerShare: null,
      },
    ]);
  });
});
