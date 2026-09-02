/**
 * Regression coverage for the Contribution Profile "Activate" bug: switching
 * the active profile must invalidate every downstream query that reads
 * contribution data as an implicit input (paycheck, contribution, retirement,
 * projection, brokerage, budget, savings), not just the app_settings pointer
 * itself — otherwise activation "takes" in the settings row but the rest of
 * the app keeps showing numbers computed under the PREVIOUS active profile
 * until an unrelated navigation happens to refetch them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useActiveContribProfile } from "@/lib/hooks/use-active-contrib-profile";

const listQuery = vi.fn();
const profileListQuery = vi.fn();
const setActiveMutateAsync = vi.fn();
let setActiveOnSuccess: (() => void) | undefined;
const invalidate = {
  appSettingsList: vi.fn(),
  contributionProfile: vi.fn(),
  contribution: vi.fn(),
  paycheck: vi.fn(),
  projection: vi.fn(),
  retirement: vi.fn(),
  brokerage: vi.fn(),
  budget: vi.fn(),
  savings: vi.fn(),
  contributionAccounts: vi.fn(),
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      settings: {
        appSettings: { list: { invalidate: invalidate.appSettingsList } },
        contributionAccounts: { invalidate: invalidate.contributionAccounts },
      },
      contributionProfile: { invalidate: invalidate.contributionProfile },
      contribution: { invalidate: invalidate.contribution },
      paycheck: { invalidate: invalidate.paycheck },
      projection: { invalidate: invalidate.projection },
      retirement: { invalidate: invalidate.retirement },
      brokerage: { invalidate: invalidate.brokerage },
      budget: { invalidate: invalidate.budget },
      savings: { invalidate: invalidate.savings },
    }),
    settings: {
      appSettings: {
        list: { useQuery: () => listQuery() },
        upsert: { useMutation: () => ({ mutate: vi.fn() }) },
      },
    },
    contributionProfile: {
      list: { useQuery: () => profileListQuery() },
      setActive: {
        useMutation: (opts?: { onSuccess?: () => void }) => {
          setActiveOnSuccess = opts?.onSuccess;
          return { mutateAsync: setActiveMutateAsync };
        },
      },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  listQuery.mockReturnValue({
    data: [{ key: "active_contrib_profile_id", value: 1 }],
  });
  profileListQuery.mockReturnValue({ data: [{ id: 1 }, { id: 2 }] });
  setActiveMutateAsync.mockResolvedValue({ success: true });
});

describe("useActiveContribProfile", () => {
  it("writes through contributionProfile.setActive, not the generic appSettings.upsert", async () => {
    const { result } = renderHook(() => useActiveContribProfile());

    await act(async () => {
      result.current[1](2);
      await Promise.resolve();
    });

    expect(setActiveMutateAsync).toHaveBeenCalledWith({ id: 2 });
  });

  it("writes through contributionProfile.setActive with id: null when clearing the selection, instead of silently no-op'ing (advisor-caught 2026-09-01)", async () => {
    const { result } = renderHook(() => useActiveContribProfile());

    await act(async () => {
      result.current[1](null);
      await Promise.resolve();
    });

    expect(setActiveMutateAsync).toHaveBeenCalledWith({ id: null });
  });

  it("invalidates every downstream query on a successful activation, not just the settings pointer", () => {
    renderHook(() => useActiveContribProfile());

    act(() => {
      setActiveOnSuccess?.();
    });

    expect(invalidate.appSettingsList).toHaveBeenCalled();
    expect(invalidate.contributionProfile).toHaveBeenCalled();
    expect(invalidate.contribution).toHaveBeenCalled();
    expect(invalidate.paycheck).toHaveBeenCalled();
    expect(invalidate.projection).toHaveBeenCalled();
    expect(invalidate.retirement).toHaveBeenCalled();
    expect(invalidate.brokerage).toHaveBeenCalled();
    expect(invalidate.budget).toHaveBeenCalled();
    expect(invalidate.savings).toHaveBeenCalled();
    expect(invalidate.contributionAccounts).toHaveBeenCalled();
  });
});
