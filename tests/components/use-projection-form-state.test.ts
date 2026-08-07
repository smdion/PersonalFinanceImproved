/**
 * Tests for useProjectionFormState — form/UI state for the projection card,
 * with a focus on the accumOverrides/decumOverrides DB-vs-local "touched"
 * merge logic (T12).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  getAllCategories,
  ACCOUNT_TYPE_CONFIG,
} from "@/lib/config/account-types";

let accumQueryData: unknown[] | undefined;
let decumQueryData: unknown[] | undefined;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    settings: {
      projectionOverrides: {
        get: {
          useQuery: (input: { overrideType: string }) => ({
            data:
              input.overrideType === "accumulation"
                ? accumQueryData
                : decumQueryData,
          }),
        },
      },
    },
  },
}));

vi.mock("@/lib/hooks/use-persisted-setting", () => ({
  usePersistedToggle: (_key: string, defaultValue = false) => [
    defaultValue,
    vi.fn(),
  ],
}));

beforeEach(() => {
  accumQueryData = undefined;
  decumQueryData = undefined;
});

async function importHook() {
  const mod =
    await import("@/components/cards/projection/use-projection-form-state");
  return mod.useProjectionFormState;
}

describe("useProjectionFormState", () => {
  it("initializes withdrawalOrder to the config-driven default decumulation order", async () => {
    const useProjectionFormState = await importHook();
    const { result } = renderHook(() => useProjectionFormState());
    expect(result.current.withdrawalOrder.length).toBeGreaterThan(0);
    for (const cat of result.current.withdrawalOrder) {
      expect(getAllCategories()).toContain(cat);
    }
  });

  it("initializes withdrawalSplits from each category's configured default split", async () => {
    const useProjectionFormState = await importHook();
    const { result } = renderHook(() => useProjectionFormState());
    for (const cat of getAllCategories()) {
      expect(result.current.withdrawalSplits[cat]).toBe(
        ACCOUNT_TYPE_CONFIG[cat].defaultWithdrawalSplit,
      );
    }
  });

  it("defaults dollarMode to 'real' and projectionMode to 'monteCarlo'", async () => {
    const useProjectionFormState = await importHook();
    const { result } = renderHook(() => useProjectionFormState());
    expect(result.current.dollarMode).toBe("real");
    expect(result.current.projectionMode).toBe("monteCarlo");
  });

  it("uses DB overrides data when local state has not been touched", async () => {
    accumQueryData = [{ year: 2030, contributionRate: 0.2 }];
    const useProjectionFormState = await importHook();
    const { result } = renderHook(() => useProjectionFormState());
    expect(result.current.accumOverrides).toEqual([
      { year: 2030, contributionRate: 0.2 },
    ]);
  });

  it("falls back to empty local overrides when DB data is empty and untouched", async () => {
    accumQueryData = [];
    const useProjectionFormState = await importHook();
    const { result } = renderHook(() => useProjectionFormState());
    expect(result.current.accumOverrides).toEqual([]);
  });

  it("local state wins over DB data once setAccumOverrides has been called (touched)", async () => {
    accumQueryData = [{ year: 2030, contributionRate: 0.2 }];
    const useProjectionFormState = await importHook();
    const { result, rerender } = renderHook(() => useProjectionFormState());

    act(() => {
      result.current.setAccumOverrides([{ year: 2031, contributionRate: 0.5 }]);
    });
    rerender();

    // Even though DB data still has the 2030 override, local (touched) state
    // — the empty array replacing it — must win.
    expect(result.current.accumOverrides).toEqual([
      { year: 2031, contributionRate: 0.5 },
    ]);
  });

  it("setDecumOverrides independently touches only the decum override state", async () => {
    accumQueryData = [{ year: 2030, contributionRate: 0.2 }];
    decumQueryData = [{ year: 2060, withdrawalRate: 0.04 }];
    const useProjectionFormState = await importHook();
    const { result, rerender } = renderHook(() => useProjectionFormState());

    act(() => {
      result.current.setDecumOverrides([{ year: 2061, withdrawalRate: 0.05 }]);
    });
    rerender();

    // Decum touched -> local wins
    expect(result.current.decumOverrides).toEqual([
      { year: 2061, withdrawalRate: 0.05 },
    ]);
    // Accum untouched -> still reflects DB data
    expect(result.current.accumOverrides).toEqual([
      { year: 2030, contributionRate: 0.2 },
    ]);
  });

  it("isPersonFiltered is false for the default 'all' personFilter and true once set to a person id", async () => {
    const useProjectionFormState = await importHook();
    const { result, rerender } = renderHook(() => useProjectionFormState());
    expect(result.current.isPersonFiltered).toBe(false);

    act(() => {
      result.current.setPersonFilter(1);
    });
    rerender();

    expect(result.current.isPersonFiltered).toBe(true);
    expect(result.current.personFilter).toBe(1);
  });
});
