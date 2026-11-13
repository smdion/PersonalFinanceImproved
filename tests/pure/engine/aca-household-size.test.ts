/**
 * The ACA cliff's household size when the input sends none: the household's
 * people, at least the return's family (26 USC 36B(d)(1)), never a fixed 2.
 */
import { describe, expect, it } from "vitest";
import { runOneYear } from "../../fixtures/answer-key";
import { engineHousehold } from "../../fixtures/answer-key-household";
import type { ProjectionInput } from "@/lib/pure/engine/types";

function headroom(
  people: number,
  householdSize: number | undefined,
  status: "Single" | "HOH" | "MFJ" = people === 1 ? "Single" : "MFJ",
) {
  const h = engineHousehold({
    status: status === "HOH" ? "Single" : status,
    people: Array.from({ length: people }, () => ({ birthYear: 1970 })),
    traditionalIra: 500_000,
    spending: 40_000,
    endYear: 2027,
  });
  const input: ProjectionInput = {
    ...h,
    filingStatus: status,
    enableAcaAwareness: true,
    householdSize,
  };
  const year = runOneYear(input, 2026);
  if (year.phase !== "decumulation") throw new Error("2026 isn't retired");
  return year.acaMagiHeadroom;
}

describe("ACA household size with none sent", () => {
  it("one person reads as a household of one", () => {
    expect(headroom(1, undefined)).toBe(headroom(1, 1));
    expect(headroom(1, undefined)).toBeLessThan(headroom(1, 2));
  });

  it("one person filing HOH reads as a household of two (a qualifying person)", () => {
    expect(headroom(1, undefined, "HOH")).toBe(headroom(1, 2, "HOH"));
  });

  it("one person entered on a joint return reads as a household of two", () => {
    expect(headroom(1, undefined, "MFJ")).toBe(headroom(1, 2, "MFJ"));
  });

  it("two people read as a household of two", () => {
    expect(headroom(2, undefined)).toBe(headroom(2, 2));
  });
});
