/**
 * Tests for projectRuleOf55's forceIneligible option (v0.7.8 Rule of 55
 * forecasting toggle). Guards the specific bug an advisor review caught in
 * a first implementation attempt: mutating the "now" status's `.eligible`
 * before calling this function did nothing for a still-employed
 * (source: "active") worker, because the function recomputes `eligible`
 * from scratch for that case and discards whatever was passed in. The
 * override must be applied AFTER that recompute, inside this function.
 */
import { describe, it, expect } from "vitest";
import { projectRuleOf55 } from "@/lib/pure/tax-bucket-projection";
import type { RuleOf55Status } from "@/lib/pure/tax-bucket-analysis";

describe("projectRuleOf55 — forceIneligible", () => {
  it("source 'active': forceIneligible overrides the recomputed eligible=true", () => {
    const now: RuleOf55Status = {
      eligible: false,
      separationYear: null,
      source: "active",
      knownFutureSeparationYear: null,
    };
    // Born 1985, projected to 2041 (age 56) -- would normally resolve
    // eligible=true (separation assumed in the projected year, which is
    // >= 55).
    const withoutOverride = projectRuleOf55(now, 2041, 1985);
    expect(withoutOverride?.eligible).toBe(true);

    const withOverride = projectRuleOf55(now, 2041, 1985, {
      forceIneligible: true,
    });
    expect(withOverride?.eligible).toBe(false);
    // separationYear/source/knownFutureSeparationYear are preserved --
    // the UI can still show "separates 2041" alongside "ineligible".
    expect(withOverride?.separationYear).toBe(withoutOverride?.separationYear);
    expect(withOverride?.source).toBe("active");
  });

  it("source not 'active' (already separated): forceIneligible still applies to the verbatim pass-through", () => {
    const now: RuleOf55Status = {
      eligible: true,
      separationYear: 2020,
      source: "derived",
      knownFutureSeparationYear: null,
    };
    const withoutOverride = projectRuleOf55(now, 2030, 1970);
    expect(withoutOverride?.eligible).toBe(true);

    const withOverride = projectRuleOf55(now, 2030, 1970, {
      forceIneligible: true,
    });
    expect(withOverride?.eligible).toBe(false);
    expect(withOverride?.separationYear).toBe(2020);
  });

  it("forceIneligible: false or omitted is a no-op (structural reduction, acceptance-criterion style)", () => {
    const now: RuleOf55Status = {
      eligible: false,
      separationYear: null,
      source: "active",
      knownFutureSeparationYear: null,
    };
    const bare = projectRuleOf55(now, 2041, 1985);
    const explicitFalse = projectRuleOf55(now, 2041, 1985, {
      forceIneligible: false,
    });
    const omitted = projectRuleOf55(now, 2041, 1985, {});
    expect(bare).toEqual(explicitFalse);
    expect(bare).toEqual(omitted);
  });

  it("null input stays null regardless of forceIneligible", () => {
    expect(projectRuleOf55(null, 2030, 1970, { forceIneligible: true })).toBe(
      null,
    );
  });

  it("one-directional: cannot force eligible=true when the underlying computation says false", () => {
    const now: RuleOf55Status = {
      eligible: false,
      separationYear: null,
      source: "active",
      knownFutureSeparationYear: null,
    };
    // Age 30 in the projected year -- genuinely not Rule-of-55 eligible.
    const result = projectRuleOf55(now, 2026, 1996, {
      forceIneligible: false,
    });
    expect(result?.eligible).toBe(false);
  });
});
