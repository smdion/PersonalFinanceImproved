/* eslint-disable no-restricted-syntax -- as unknown as casts build minimal decumulation rows without every unrelated engine field */
/**
 * assessPlan — the one plan judge (fictional year rows).
 */
import { describe, it, expect } from "vitest";
import {
  assessPlan,
  dominantFailureReason,
  planFailurePhrase,
} from "@/lib/calculators/plan-outcome";
import type { ProjectionResult } from "@/lib/calculators/types";

type Row = {
  age: number;
  retirementBalance: number;
  unmetNeed?: number;
  unmetNeedMaterial?: boolean;
  penaltyAvoidedShortfall?: number;
  afterTaxNeed?: number;
  phase?: "accumulation" | "decumulation";
};
const plan = (rows: Row[]) =>
  ({
    projectionByYear: rows.map((r) => ({
      phase: "decumulation",
      year: 2000 + r.age,
      afterTaxNeed: 60000,
      shortfallMaterialityFloor: Math.max(50, (r.afterTaxNeed ?? 60000) * 0.01),
      ...r,
    })),
  }) as unknown as Pick<ProjectionResult, "projectionByYear">;

describe("assessPlan", () => {
  it("succeeds when every retirement year is funded and money lasts", () => {
    expect(
      assessPlan(
        plan([
          { age: 64, retirementBalance: 0, phase: "accumulation" },
          { age: 65, retirementBalance: 500000 },
          { age: 66, retirementBalance: 450000 },
        ]),
      ),
    ).toEqual({
      succeeded: true,
      failureAge: null,
      failureYear: null,
      failureReason: null,
    });
  });

  it("fails the year retirement money runs out", () => {
    expect(
      assessPlan(
        plan([
          { age: 65, retirementBalance: 50000 },
          { age: 66, retirementBalance: 0 },
          {
            age: 67,
            retirementBalance: 0,
            unmetNeed: 60000,
            unmetNeedMaterial: true,
          },
        ]),
      ),
    ).toMatchObject({
      succeeded: false,
      failureAge: 66,
      failureReason: "depleted",
    });
  });

  it("out of money with Social Security covering every later year: the plan held", () => {
    expect(
      assessPlan(
        plan([
          { age: 70, retirementBalance: 20000 },
          { age: 71, retirementBalance: 0 },
          { age: 72, retirementBalance: 0, afterTaxNeed: 0 },
          { age: 73, retirementBalance: 0, afterTaxNeed: 0 },
        ]),
      ).succeeded,
    ).toBe(true);
  });

  it("a few dollars left is out of money (below the year's materiality floor)", () => {
    expect(
      assessPlan(
        plan([
          { age: 80, retirementBalance: 3 },
          {
            age: 81,
            retirementBalance: 0,
            unmetNeed: 60000,
            unmetNeedMaterial: true,
          },
        ]),
      ),
    ).toMatchObject({ failureAge: 80, failureReason: "depleted" });
  });

  it("spending down to $0 in the plan's final year, every year funded, succeeds", () => {
    expect(
      assessPlan(
        plan([
          { age: 94, retirementBalance: 40000 },
          { age: 95, retirementBalance: 0 },
        ]),
      ).succeeded,
    ).toBe(true);
  });

  it("unmet spending while money remains: a penalty gap when locked money is most of it", () => {
    expect(
      assessPlan(
        plan([
          {
            age: 56,
            retirementBalance: 900000,
            unmetNeed: 30000,
            unmetNeedMaterial: true,
            penaltyAvoidedShortfall: 30000,
          },
        ]),
      ),
    ).toMatchObject({ failureAge: 56, failureReason: "penaltyGap" });
    expect(
      assessPlan(
        plan([
          {
            age: 80,
            retirementBalance: 900000,
            unmetNeed: 30000,
            unmetNeedMaterial: true,
            penaltyAvoidedShortfall: 1000,
          },
        ]),
      ),
    ).toMatchObject({ failureAge: 80, failureReason: "shortfall" });
  });

  it("a non-material shortfall doesn't fail the plan", () => {
    expect(
      assessPlan(
        plan([
          {
            age: 70,
            retirementBalance: 300000,
            unmetNeed: 20,
            unmetNeedMaterial: false,
          },
          { age: 71, retirementBalance: 280000 },
        ]),
      ).succeeded,
    ).toBe(true);
  });
});

describe("failure wording", () => {
  it("names the most common way failing futures fail", () => {
    expect(
      dominantFailureReason({ depleted: 0.05, penaltyGap: 0.2, shortfall: 0 }),
    ).toBe("penaltyGap");
    expect(planFailurePhrase("penaltyGap")).toMatch(
      /early-withdrawal penalties/,
    );
    expect(
      dominantFailureReason({ depleted: 0, penaltyGap: 0, shortfall: 0 }),
    ).toBeNull();
  });
});
