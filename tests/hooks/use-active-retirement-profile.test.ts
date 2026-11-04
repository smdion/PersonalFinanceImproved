/**
 * Regression coverage for the Retirement Profile "Activate" invalidation
 * gap: switching the active Retirement Profile only invalidated
 * settings.appSettings.list (the default upsert path's own onSuccess) —
 * every already-mounted retirement.* / projection.* query kept serving
 * numbers computed under the PREVIOUS active profile, the same bug class
 * already fixed for Contribution/Salary Profile activation but never
 * applied to this sibling hook.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useActiveRetirementProfile } from "@/lib/hooks/use-active-retirement-profile";
import {
  mutationCalls,
  resetTrpcMock,
  setQuery,
  utilsCalls,
} from "../components/trpc-mock";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("../components/trpc-mock")).trpc,
}));

const UPSERT = "settings.appSettings.upsert";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetTrpcMock();
  setQuery("settings.appSettings.list", [
    { key: "active_retirement_profile_id", value: 1 },
  ]);
  setQuery("retirement.retirementProfiles.list", [{ id: 1 }, { id: 2 }]);
});

describe("useActiveRetirementProfile", () => {
  it("writes through the admin-gated appSettings.upsert (correct — Retirement Profile CRUD is adminProcedure throughout by design)", async () => {
    const { result } = renderHook(() => useActiveRetirementProfile());

    await act(async () => {
      result.current[1](2);
      await Promise.resolve();
    });

    expect(mutationCalls(UPSERT)).toContainEqual({
      key: "active_retirement_profile_id",
      value: 2,
    });
  });

  it("invalidates every downstream query on a successful activation, not just the settings pointer", () => {
    const { result } = renderHook(() => useActiveRetirementProfile());

    // The activation succeeds: its own mutation's onSuccess runs.
    act(() => {
      result.current[1](2);
    });

    for (const path of [
      "settings.appSettings.list.invalidate",
      "retirement.invalidate",
      "projection.invalidate",
      "brokerage.invalidate",
      "budget.invalidate",
      "savings.invalidate",
    ])
      expect(utilsCalls(path), path).not.toHaveLength(0);
  });
});
