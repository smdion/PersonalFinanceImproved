/**
 * withControlledOverrides — a what-if's fields win over saved rows.
 */
import { describe, it, expect } from "vitest";
import { withControlledOverrides } from "@/lib/pure/controlled-overrides";
import type { DecumulationOverride } from "@/lib/calculators/types";

const row = (o: Record<string, unknown>) => o as DecumulationOverride;

describe("withControlledOverrides", () => {
  it("a saved later-year row can't undo the what-if's field; its other fields stay", () => {
    const saved = [
      row({
        year: 2045,
        rothConversionTarget: 0.22,
        withdrawalRoutingMode: "waterfall",
      }),
      row({ year: 2050, rothConversionTarget: 0.24 }),
    ];
    const whatIf = [row({ year: 2040, rothConversionTarget: 0 })];
    expect(withControlledOverrides(saved, whatIf)).toEqual([
      row({ year: 2045, withdrawalRoutingMode: "waterfall" }),
      row({ year: 2040, rothConversionTarget: 0 }),
    ]);
  });

  it("nothing to control: the saved rows are kept as they are", () => {
    const saved = [row({ year: 2045, rothConversionTarget: 0.22 })];
    expect(withControlledOverrides(saved, [])).toEqual(saved);
  });
});
