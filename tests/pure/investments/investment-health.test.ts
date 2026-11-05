/** Investment-data monitors. Invented accounts only. */
import { describe, it, expect } from "vitest";
import {
  holdingsGapSince,
  investmentHealthIssues,
} from "@/lib/pure/investments/investment-health";

const account = (
  over: Partial<Parameters<typeof investmentHealthIssues>[0][number]> = {},
) => ({
  label: "Example Plan",
  holdingsAsOf: "2026-06-12",
  holdingsValue: 10_000,
  gapSince: null,
  balance: 10_000,
  ...over,
});

describe("investmentHealthIssues", () => {
  it("is quiet for current holdings that match the balance", () => {
    expect(investmentHealthIssues([account()], "2026-06-15")).toEqual([]);
  });

  it("flags holdings an account stopped reporting", () => {
    const [issue] = investmentHealthIssues(
      [account({ holdingsAsOf: "2026-06-01" })],
      "2026-06-15",
    );
    expect(issue).toMatchObject({ kind: "holdings_stale" });
    expect(issue!.message).toMatch(/14 days ago/);
  });

  it("tolerates a small gap from late plan pricing but flags a large one", () => {
    expect(
      investmentHealthIssues([account({ holdingsValue: 9_800 })], "2026-06-15"),
    ).toEqual([]);
    const [issue] = investmentHealthIssues(
      [account({ holdingsValue: 7_000, gapSince: "2026-06-01" })],
      "2026-06-15",
    );
    expect(issue).toMatchObject({ kind: "holdings_gap" });
    expect(issue!.message).toMatch(/30% less/);
  });

  it("ignores accounts that never reported holdings", () => {
    expect(
      investmentHealthIssues(
        [account({ holdingsAsOf: null, holdingsValue: null })],
        "2026-06-15",
      ),
    ).toEqual([]);
  });
});

describe("a gap between holdings and the balance", () => {
  const today = "2026-10-31";
  const gapped = (gapSince: string) =>
    account({
      holdingsAsOf: "2026-10-30",
      holdingsValue: 0.19,
      balance: 625.19,
      gapSince,
    });

  it("a deposit waiting to be invested isn't an alarm", () => {
    expect(investmentHealthIssues([gapped("2026-10-30")], today)).toEqual([]);
  });

  it("past the grace period it is, and says how long", () => {
    const [issue] = investmentHealthIssues([gapped("2026-10-20")], today);
    expect(issue).toMatchObject({ kind: "holdings_gap" });
    expect(issue!.message).toContain("for 11 days");
  });

  it("the run starts at its first gap and a matching report ends it", () => {
    const r = (
      asOf: string,
      holdingsValue: number | null,
      balance: number,
    ) => ({
      asOf,
      holdingsValue,
      balance,
    });
    expect(
      holdingsGapSince([
        r("2026-10-27", 0.19, 0.19),
        r("2026-10-28", 0.19, 625.19),
        r("2026-10-29", null, 625.19), // can't compare: neither
        r("2026-10-30", 0.19, 625.19),
      ]),
    ).toBe("2026-10-28");
    expect(
      holdingsGapSince([
        r("2026-10-28", 0.19, 625.19),
        r("2026-10-30", 625.19, 625.19),
      ]),
    ).toBeNull();
  });
});
