import { describe, it, expect } from "vitest";
import { contributionsSummaryLine } from "@/lib/pure/plain-summary";

describe("contributionsSummaryLine", () => {
  it("says the rate, the dollars, what's counted and the next step", () => {
    expect(
      contributionsSummaryLine({
        rate: 0.293,
        annualAmount: 77_000,
        matchIncluded: false,
        includePortfolio: true,
        nextAction: "Pat 401k: $5,642.34 of room",
      }),
    ).toBe(
      "You're saving 29% of your pay — $77,000.00 a year (before employer match). Next: Pat 401k: $5,642.34 of room.",
    );
  });

  it("notes a retirement-only rate and leaves out an empty next step", () => {
    expect(
      contributionsSummaryLine({
        rate: 0.249,
        annualAmount: 66_000,
        matchIncluded: true,
        includePortfolio: false,
        nextAction: null,
      }),
    ).toBe(
      "You're saving 25% of your pay — $66,000.00 a year (retirement accounts only, employer match included).",
    );
  });
});
