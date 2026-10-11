/** Investment-data monitors. Invented accounts only. */
import { describe, it, expect } from "vitest";
import { investmentHealthIssues } from "@/lib/pure/investment-health";

const account = (
  over: Partial<Parameters<typeof investmentHealthIssues>[0][number]> = {},
) => ({
  label: "Example Plan",
  holdingsAsOf: "2026-06-12",
  holdingsValue: 10_000,
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
      [account({ holdingsValue: 7_000 })],
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
