/**
 * Twin of use-active-contrib-profile.test.ts — same bug, same fix, other
 * axis. See that file's docblock for the full rationale.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useActiveSalaryProfile } from "@/lib/hooks/use-active-salary-profile";

const listQuery = vi.fn();
const profileListQuery = vi.fn();
const setActiveMutateAsync = vi.fn();
let setActiveOnSuccess: (() => void) | undefined;
const invalidate = {
  appSettingsList: vi.fn(),
  salaryProfile: vi.fn(),
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
      salaryProfile: { invalidate: invalidate.salaryProfile },
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
    salaryProfile: {
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
    data: [{ key: "active_salary_profile_id", value: 1 }],
  });
  profileListQuery.mockReturnValue({ data: [{ id: 1 }, { id: 2 }] });
  setActiveMutateAsync.mockResolvedValue({ success: true });
});

describe("useActiveSalaryProfile", () => {
  it("writes through salaryProfile.setActive, not the generic appSettings.upsert", async () => {
    const { result } = renderHook(() => useActiveSalaryProfile());

    await act(async () => {
      result.current[1](2);
      await Promise.resolve();
    });

    expect(setActiveMutateAsync).toHaveBeenCalledWith({ id: 2 });
  });

  it("invalidates every downstream query on a successful activation, not just the settings pointer", () => {
    renderHook(() => useActiveSalaryProfile());

    act(() => {
      setActiveOnSuccess?.();
    });

    expect(invalidate.appSettingsList).toHaveBeenCalled();
    expect(invalidate.salaryProfile).toHaveBeenCalled();
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
