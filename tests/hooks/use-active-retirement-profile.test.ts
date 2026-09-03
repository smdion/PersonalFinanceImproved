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

const listQuery = vi.fn();
const profileListQuery = vi.fn();
const upsertMutateAsync = vi.fn();
// usePersistedSetting internally constructs its OWN default
// appSettings.upsert mutation too (unused here since writeVia bypasses
// it, but still a real useMutation() call) -- both share this mock, so
// capture every onSuccess in creation order rather than a single
// variable. The hook under test creates its custom broad-invalidation
// mutation FIRST, before calling usePersistedSetting, so index 0 is ours.
const upsertOnSuccessCalls: (() => void)[] = [];
const invalidate = {
  appSettingsList: vi.fn(),
  retirement: vi.fn(),
  projection: vi.fn(),
  brokerage: vi.fn(),
  budget: vi.fn(),
  savings: vi.fn(),
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      settings: {
        appSettings: { list: { invalidate: invalidate.appSettingsList } },
      },
      retirement: { invalidate: invalidate.retirement },
      projection: { invalidate: invalidate.projection },
      brokerage: { invalidate: invalidate.brokerage },
      budget: { invalidate: invalidate.budget },
      savings: { invalidate: invalidate.savings },
    }),
    settings: {
      appSettings: {
        list: { useQuery: () => listQuery() },
        upsert: {
          useMutation: (opts?: { onSuccess?: () => void }) => {
            if (opts?.onSuccess) upsertOnSuccessCalls.push(opts.onSuccess);
            return { mutateAsync: upsertMutateAsync };
          },
        },
      },
    },
    retirement: {
      retirementProfiles: {
        list: { useQuery: () => profileListQuery() },
      },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  upsertOnSuccessCalls.length = 0;
  localStorage.clear();
  listQuery.mockReturnValue({
    data: [{ key: "active_retirement_profile_id", value: 1 }],
  });
  profileListQuery.mockReturnValue({ data: [{ id: 1 }, { id: 2 }] });
  upsertMutateAsync.mockResolvedValue(undefined);
});

describe("useActiveRetirementProfile", () => {
  it("writes through the admin-gated appSettings.upsert (correct — Retirement Profile CRUD is adminProcedure throughout by design)", async () => {
    const { result } = renderHook(() => useActiveRetirementProfile());

    await act(async () => {
      result.current[1](2);
      await Promise.resolve();
    });

    expect(upsertMutateAsync).toHaveBeenCalledWith({
      key: "active_retirement_profile_id",
      value: 2,
    });
  });

  it("invalidates every downstream query on a successful activation, not just the settings pointer", () => {
    renderHook(() => useActiveRetirementProfile());

    act(() => {
      upsertOnSuccessCalls[0]?.();
    });

    expect(invalidate.appSettingsList).toHaveBeenCalled();
    expect(invalidate.retirement).toHaveBeenCalled();
    expect(invalidate.projection).toHaveBeenCalled();
    expect(invalidate.brokerage).toHaveBeenCalled();
    expect(invalidate.budget).toHaveBeenCalled();
    expect(invalidate.savings).toHaveBeenCalled();
  });
});
