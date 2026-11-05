/**
 * One sentence for how a projection treats an HSA withdrawal, shown in
 * Taxes, the projection table and the methodology — built from the
 * configured age and rate.
 */
import { describe, it, expect } from "vitest";
import { HSA_DRAW_TREATMENT } from "@/lib/pure/accounts/early-access";

describe("HSA_DRAW_TREATMENT", () => {
  it("says the projection's assumption, with the configured age and rate", () => {
    expect(HSA_DRAW_TREATMENT).toContain("non-medical");
    expect(HSA_DRAW_TREATMENT).toContain("ordinary income");
    expect(HSA_DRAW_TREATMENT).toContain("20% penalty before age 65");
    expect(HSA_DRAW_TREATMENT).toContain("doesn't model");
  });
});
