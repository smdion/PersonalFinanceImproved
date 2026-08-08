/**
 * T1 — useSalaryOverrides extraction from scenario context: pulls
 * { personId, salary } pairs out of activeScenario.overrides.people, where
 * the map is keyed by string personId and values may carry a `salary`
 * override field alongside other unrelated per-person override fields.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSalaryOverrides } from "@/lib/hooks/use-salary-overrides";

const mockUseScenario = vi.fn();
vi.mock("@/lib/context/scenario-context", () => ({
  useScenario: () => mockUseScenario(),
}));

describe("useSalaryOverrides", () => {
  it("returns an empty array when there is no active scenario", () => {
    mockUseScenario.mockReturnValue({ activeScenario: null });
    const { result } = renderHook(() => useSalaryOverrides());
    expect(result.current).toEqual([]);
  });

  it("returns an empty array when the scenario has no people overrides", () => {
    mockUseScenario.mockReturnValue({
      activeScenario: { overrides: {} },
    });
    const { result } = renderHook(() => useSalaryOverrides());
    expect(result.current).toEqual([]);
  });

  it("extracts personId/salary pairs from people overrides", () => {
    mockUseScenario.mockReturnValue({
      activeScenario: {
        overrides: {
          people: {
            "3": { salary: 150000 },
            "7": { salary: 95000 },
          },
        },
      },
    });
    const { result } = renderHook(() => useSalaryOverrides());
    expect(result.current).toEqual(
      expect.arrayContaining([
        { personId: 3, salary: 150000 },
        { personId: 7, salary: 95000 },
      ]),
    );
    expect(result.current).toHaveLength(2);
  });

  it("skips people entries with no salary field", () => {
    mockUseScenario.mockReturnValue({
      activeScenario: {
        overrides: {
          people: {
            "3": { salary: 150000 },
            "7": { retirementAge: 62 }, // no salary field
          },
        },
      },
    });
    const { result } = renderHook(() => useSalaryOverrides());
    expect(result.current).toEqual([{ personId: 3, salary: 150000 }]);
  });

  it("coerces string salary values to numbers", () => {
    mockUseScenario.mockReturnValue({
      activeScenario: {
        overrides: {
          people: {
            "3": { salary: "150000" },
          },
        },
      },
    });
    const { result } = renderHook(() => useSalaryOverrides());
    expect(result.current).toEqual([{ personId: 3, salary: 150000 }]);
  });
});
