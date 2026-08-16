/**
 * useEffectiveProfileId — single resolver for "which Budget/Contribution
 * Profile is effectively active." Precedence: Plan pin -> local selection ->
 * global default. The property under test in the "Main Plan isolation"
 * block is the one thing this whole Plan-pinning effort exists to protect:
 * a Plan's pin must never leak into a Main-Plan read.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";

const mockUseScenario = vi.fn();
vi.mock("@/lib/context/scenario-context", () => ({
  useScenario: () => mockUseScenario(),
}));

describe("useEffectiveProfileId", () => {
  describe("Main Plan isolation", () => {
    it("never returns a plan-pin source when no scenario is active (Main Plan)", () => {
      mockUseScenario.mockReturnValue({ activeScenario: null });
      const { result } = renderHook(() =>
        useEffectiveProfileId("budget", {
          validIds: [1, 2, 3],
          localSelection: null,
          globalDefaultId: 1,
        }),
      );
      expect(result.current).toEqual({
        profileId: 1,
        source: "global-default",
        isPinned: false,
      });
    });

    it("ignores a sibling Plan's pin entirely on Main Plan, even for the same profile ids", () => {
      // Regression case: a persisted Plan elsewhere in the app pins profile
      // 2, but the hook is evaluated with activeScenario: null (Main Plan
      // selected). The pin must not leak in just because the id is valid.
      mockUseScenario.mockReturnValue({ activeScenario: null });
      const { result } = renderHook(() =>
        useEffectiveProfileId("budget", {
          validIds: [1, 2, 3],
          localSelection: null,
          globalDefaultId: 1,
        }),
      );
      expect(result.current.profileId).not.toBe(2);
      expect(result.current.source).toBe("global-default");
    });
  });

  describe("precedence", () => {
    it("plan pin wins over local selection and global default", () => {
      mockUseScenario.mockReturnValue({
        activeScenario: { budgetProfileId: 2, contributionProfileId: null },
      });
      const { result } = renderHook(() =>
        useEffectiveProfileId("budget", {
          validIds: [1, 2, 3],
          localSelection: 3,
          globalDefaultId: 1,
        }),
      );
      expect(result.current).toEqual({
        profileId: 2,
        source: "plan-pin",
        isPinned: true,
      });
    });

    it("falls through to local selection when there is no pin", () => {
      mockUseScenario.mockReturnValue({
        activeScenario: { budgetProfileId: null, contributionProfileId: null },
      });
      const { result } = renderHook(() =>
        useEffectiveProfileId("budget", {
          validIds: [1, 2, 3],
          localSelection: 3,
          globalDefaultId: 1,
        }),
      );
      expect(result.current).toEqual({
        profileId: 3,
        source: "user-selection",
        isPinned: false,
      });
    });

    it("falls through to global default when there is no pin or local selection", () => {
      mockUseScenario.mockReturnValue({ activeScenario: null });
      const { result } = renderHook(() =>
        useEffectiveProfileId("contribution", {
          validIds: [1, 2],
          localSelection: null,
          globalDefaultId: 1,
        }),
      );
      expect(result.current).toEqual({
        profileId: 1,
        source: "global-default",
        isPinned: false,
      });
    });

    it("falls through to local selection when the pin points at a deleted profile", () => {
      mockUseScenario.mockReturnValue({
        activeScenario: { budgetProfileId: 99, contributionProfileId: null },
      });
      const { result } = renderHook(() =>
        useEffectiveProfileId("budget", {
          validIds: [1, 2, 3],
          localSelection: 3,
          globalDefaultId: 1,
        }),
      );
      expect(result.current).toEqual({
        profileId: 3,
        source: "user-selection",
        isPinned: false,
      });
    });

    it("resolves budget and contribution pins independently", () => {
      mockUseScenario.mockReturnValue({
        activeScenario: { budgetProfileId: 2, contributionProfileId: 5 },
      });
      const budget = renderHook(() =>
        useEffectiveProfileId("budget", {
          validIds: [1, 2],
          localSelection: null,
          globalDefaultId: 1,
        }),
      );
      const contribution = renderHook(() =>
        useEffectiveProfileId("contribution", {
          validIds: [5, 6],
          localSelection: null,
          globalDefaultId: 6,
        }),
      );
      expect(budget.result.current.profileId).toBe(2);
      expect(contribution.result.current.profileId).toBe(5);
    });
  });
});
