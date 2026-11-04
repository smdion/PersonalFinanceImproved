/**
 * Regression coverage for the Contribution / Salary Profile "Activate" bug:
 * switching the active profile must invalidate every downstream query that
 * reads that profile's data as an implicit input (paycheck, contribution,
 * retirement, projection, brokerage, budget, savings), not just the
 * app_settings pointer itself — otherwise activation "takes" in the
 * settings row but the rest of the app keeps showing numbers computed under
 * the PREVIOUS active profile until an unrelated navigation refetches them.
 *
 * Both hooks share the fix and the contract, so one table drives both. The
 * Retirement Profile hook writes through appSettings.upsert instead and has
 * its own file (use-active-retirement-profile.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useActiveContribProfile } from "@/lib/hooks/use-active-contrib-profile";
import { useActiveSalaryProfile } from "@/lib/hooks/use-active-salary-profile";
import {
  mutationCalls,
  resetTrpcMock,
  setMutationResult,
  setQuery,
  utilsCalls,
} from "../components/trpc-mock";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("../components/trpc-mock")).trpc,
}));

describe.each([
  {
    hook: useActiveContribProfile,
    router: "contributionProfile" as const,
    settingKey: "active_contrib_profile_id",
  },
  {
    hook: useActiveSalaryProfile,
    router: "salaryProfile" as const,
    settingKey: "active_salary_profile_id",
  },
])("$hook.name", ({ hook, router, settingKey }) => {
  // Each router has its own setActive, so a hook writing through the
  // other profile's procedure fails the test.
  const ownSetActive = () => mutationCalls(`${router}.setActive`);

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetTrpcMock();
    setQuery("settings.appSettings.list", [{ key: settingKey, value: 1 }]);
    setQuery("contributionProfile.list", [{ id: 1 }, { id: 2 }]);
    setQuery("salaryProfile.list", [{ id: 1 }, { id: 2 }]);
    setMutationResult("contributionProfile.setActive", { success: true });
    setMutationResult("salaryProfile.setActive", { success: true });
  });

  it(`writes through ${router}.setActive, not the generic appSettings.upsert`, async () => {
    const { result } = renderHook(() => hook());

    await act(async () => {
      result.current[1](2);
      await Promise.resolve();
    });

    expect(ownSetActive()).toContainEqual({ id: 2 });
  });

  it(`writes through ${router}.setActive with id: null when clearing the selection, instead of silently no-op'ing (advisor-caught 2026-09-01)`, async () => {
    const { result } = renderHook(() => hook());

    await act(async () => {
      result.current[1](null);
      await Promise.resolve();
    });

    expect(ownSetActive()).toContainEqual({ id: null });
  });

  it("invalidates every downstream query on a successful activation, not just the settings pointer", () => {
    const { result } = renderHook(() => hook());

    // The activation succeeds: setActive's onSuccess runs.
    act(() => {
      result.current[1](2);
    });

    for (const path of [
      "settings.appSettings.list.invalidate",
      `${router}.invalidate`,
      "contribution.invalidate",
      "paycheck.invalidate",
      "projection.invalidate",
      "retirement.invalidate",
      "brokerage.invalidate",
      "budget.invalidate",
      "savings.invalidate",
      "settings.contributionAccounts.invalidate",
    ])
      expect(utilsCalls(path), path).not.toHaveLength(0);
  });
});
