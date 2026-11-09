import { describe, it, expect } from "vitest";
import { classifyContribResolution } from "@/lib/pure/contributions/profile-fields";

// ---------------------------------------------------------------------------
// classifyContributionResolution
// ---------------------------------------------------------------------------

describe("classifyContributionResolution", () => {
  const rawIds = new Set([1, 2, 3]);

  it("returns account_unavailable when the account isn't in the global active fetch", () => {
    const status = classifyContribResolution(
      99,
      rawIds,
      {},
      new Set(),
      new Set(),
    );
    expect(status).toBe("account_unavailable");
  });

  it("returns not_in_profile when the profile has no contributionValue entry", () => {
    const status = classifyContribResolution(
      1,
      rawIds,
      {},
      new Set([1]),
      new Set(),
    );
    expect(status).toBe("not_in_profile");
  });

  it("returns inactive_in_profile when the profile's entry sets isActive: false", () => {
    const status = classifyContribResolution(
      1,
      rawIds,
      { "1": { contributionValue: "100", isActive: false } },
      new Set(),
      new Set(),
    );
    expect(status).toBe("inactive_in_profile");
  });

  it("returns inactive_in_sandbox when the profile resolves but the account didn't survive the sandbox overlay", () => {
    const status = classifyContribResolution(
      1,
      rawIds,
      { "1": { contributionValue: "100" } },
      new Set(), // sandbox overlay dropped it
      new Set(),
    );
    expect(status).toBe("inactive_in_sandbox");
  });

  it("returns no_pay_period when the account resolved but has no resolvable pay period", () => {
    const status = classifyContribResolution(
      1,
      rawIds,
      { "1": { contributionValue: "100" } },
      new Set([1]),
      new Set([1]),
    );
    expect(status).toBe("no_pay_period");
  });

  it("returns ok when the account fully resolves", () => {
    const status = classifyContribResolution(
      1,
      rawIds,
      { "1": { contributionValue: "100" } },
      new Set([1]),
      new Set(),
    );
    expect(status).toBe("ok");
  });
});
