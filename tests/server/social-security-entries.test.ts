import { describe, it, expect } from "vitest";
import {
  buildSocialSecurityEntries,
  type SsPerson,
} from "@/server/retirement/social-security-entries";

// birthYear 1963 -> FRA 67 (1960+ band) for everyone below unless noted.
function person(overrides: Partial<SsPerson> = {}): SsPerson {
  return {
    personId: 1,
    name: "P1",
    birthYear: 1963,
    socialSecurityMonthly: "2000",
    socialSecurityPia: null,
    ssStartAge: 67,
    ...overrides,
  };
}

describe("buildSocialSecurityEntries", () => {
  it("no PIA -> flat monthly * 12, unchanged by claiming age", () => {
    const [a, b] = buildSocialSecurityEntries(
      [
        person({ personId: 1, socialSecurityMonthly: "2000", ssStartAge: 62 }),
        person({ personId: 2, socialSecurityMonthly: "1500", ssStartAge: 70 }),
      ],
      "Single",
    );
    expect(a.annualAmount).toBe(24000);
    expect(b.annualAmount).toBe(18000);
    expect(a.startAge).toBe(62);
    expect(b.startAge).toBe(70);
  });

  it("PIA opted-in -> claiming-age-adjusted own benefit", () => {
    const [a] = buildSocialSecurityEntries(
      [
        person({
          personId: 1,
          socialSecurityPia: "4000", // $48k/yr at FRA
          ssStartAge: 62, // 60mo early, FRA 67 -> 0.70
        }),
        person({ personId: 2, socialSecurityMonthly: "1000" }),
      ],
      "Single",
    );
    expect(a.annualAmount).toBeCloseTo(48000 * 0.7, 2);
  });

  it("MFJ + 2: the low earner is bumped to 50% of the worker's PIA (greater-of)", () => {
    const [alex, sam] = buildSocialSecurityEntries(
      [
        person({
          personId: 1,
          socialSecurityPia: "4000", // $48k PIA
          ssStartAge: 62,
        }),
        person({
          personId: 2,
          socialSecurityMonthly: "1800", // flat $21.6k/yr, no PIA
          ssStartAge: 67, // at FRA -> spousal unreduced
        }),
      ],
      "MFJ",
    );
    // Alex: own $48k * 0.70 = $33,600. Spousal off Sam's record needs
    // Sam to have a PIA — Sam doesn't, so Alex keeps own.
    expect(alex.annualAmount).toBeCloseTo(33600, 2);
    // Sam: own flat $21,600 vs 50% of Alex's $48k PIA (claimed at FRA,
    // unreduced) = $24,000 -> bumped to $24,000.
    expect(sam.annualAmount).toBeCloseTo(24000, 2);
  });

  it("MFJ + 2, both opted into PIA: exact own+excess formula for an early claimer", () => {
    // Low earner: own PIA $12k/yr, claims at 62 (FRA 67). High earner: PIA
    // $48k/yr, files at 62 (so filed before the low earner claims).
    // SSA-exact: reducedOwn = 12000 * 0.70 = 8,400.
    //            excess = max(0, 0.5*48000 - 12000) = 12,000.
    //            spousal reduction at 62 (FRA 67): 0.65.
    //            reducedExcess = 12000 * 0.65 = 7,800.
    //            total = 8,400 + 7,800 = 16,200.
    // The old max() shortcut would have given max(8400, 24000*0.65) =
    // max(8400, 15600) = 15,600 — this is the +$600 the exact formula adds.
    const [low] = buildSocialSecurityEntries(
      [
        person({
          personId: 1,
          socialSecurityMonthly: "1000",
          socialSecurityPia: "1000", // $12k/yr PIA
          ssStartAge: 62,
        }),
        person({
          personId: 2,
          socialSecurityMonthly: "4000",
          socialSecurityPia: "4000", // $48k/yr PIA
          ssStartAge: 62,
        }),
      ],
      "MFJ",
    );
    expect(low.annualAmount).toBeCloseTo(16200, 2);
  });

  it("MFJ + 2: no spousal top-up before the worker has filed", () => {
    const [, sam] = buildSocialSecurityEntries(
      [
        person({
          personId: 1,
          socialSecurityPia: "4000",
          ssStartAge: 70, // worker delays
        }),
        person({
          personId: 2,
          socialSecurityMonthly: "1800",
          ssStartAge: 67, // claims before the worker files
        }),
      ],
      "MFJ",
    );
    expect(sam.annualAmount).toBe(21600); // own flat, no spousal
  });

  it("does not apply spousal math for Single / HOH / 3+ people", () => {
    const single = buildSocialSecurityEntries(
      [
        person({ personId: 1, socialSecurityPia: "4000", ssStartAge: 67 }),
        person({ personId: 2, socialSecurityMonthly: "1800", ssStartAge: 67 }),
      ],
      "HOH",
    );
    expect(single[1]!.annualAmount).toBe(21600); // own flat, no bump

    const three = buildSocialSecurityEntries(
      [
        person({ personId: 1, socialSecurityPia: "4000" }),
        person({ personId: 2, socialSecurityMonthly: "1800" }),
        person({ personId: 3, socialSecurityMonthly: "1000" }),
      ],
      "MFJ", // MFJ but 3 people -> no spousal
    );
    expect(three[1]!.annualAmount).toBe(21600);
  });

  it("ssStartAgeDelta shifts every claiming age (clamped at 70) and re-derives amounts", () => {
    const [a, b] = buildSocialSecurityEntries(
      [
        person({
          personId: 1,
          socialSecurityPia: "4000", // $48k PIA
          ssStartAge: 62,
        }),
        person({ personId: 2, socialSecurityMonthly: "1500", ssStartAge: 69 }),
      ],
      "Single",
      3, // delay everyone 3 years
    );
    expect(a.startAge).toBe(65); // 62 + 3
    expect(b.startAge).toBe(70); // 69 + 3, clamped at 70
    // Person A now claims at 65 (24mo early, FRA 67 -> 0.8667 multiplier).
    expect(a.annualAmount).toBeCloseTo(48000 * (1 - 24 * (5 / 9 / 100)), 0);
    // Person B: no PIA, flat unchanged by the shift.
    expect(b.annualAmount).toBe(18000);
  });
});
