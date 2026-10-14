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

const listQuery = vi.fn();
const profileListQuery = vi.fn();
let setActiveOnSuccess: (() => void) | undefined;
const invalidate = {
  appSettingsList: vi.fn(),
  contributionProfile: vi.fn(),
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

// Each router gets its own setActive, so a hook writing through the other
// profile's procedure fails the test.
const setActive = {
  contributionProfile: vi.fn(),
  salaryProfile: vi.fn(),
};
const profileRouter = (mutateAsync: (input: unknown) => unknown) => ({
  list: { useQuery: () => profileListQuery() },
  setActive: {
    useMutation: (opts?: { onSuccess?: () => void }) => {
      setActiveOnSuccess = opts?.onSuccess;
      return { mutateAsync };
    },
  },
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      settings: {
        appSettings: { list: { invalidate: invalidate.appSettingsList } },
        contributionAccounts: { invalidate: invalidate.contributionAccounts },
      },
      contributionProfile: { invalidate: invalidate.contributionProfile },
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
    // Getters: vi.mock is hoisted above profileRouter's declaration.
    get contributionProfile() {
      return profileRouter(setActive.contributionProfile);
    },
    get salaryProfile() {
      return profileRouter(setActive.salaryProfile);
    },
  },
}));

describe.each([
  {
    hook: useActiveContribProfile,
    router: "contributionProfile",
    settingKey: "active_contrib_profile_id",
    ownInvalidate: invalidate.contributionProfile,
    ownSetActive: setActive.contributionProfile,
  },
  {
    hook: useActiveSalaryProfile,
    router: "salaryProfile",
    settingKey: "active_salary_profile_id",
    ownInvalidate: invalidate.salaryProfile,
    ownSetActive: setActive.salaryProfile,
  },
])(
  "$hook.name",
  ({ hook, router, settingKey, ownInvalidate, ownSetActive }) => {
    beforeEach(() => {
      vi.clearAllMocks();
      localStorage.clear();
      listQuery.mockReturnValue({ data: [{ key: settingKey, value: 1 }] });
      profileListQuery.mockReturnValue({ data: [{ id: 1 }, { id: 2 }] });
      setActive.contributionProfile.mockResolvedValue({ success: true });
      setActive.salaryProfile.mockResolvedValue({ success: true });
    });

    it(`writes through ${router}.setActive, not the generic appSettings.upsert`, async () => {
      const { result } = renderHook(() => hook());

      await act(async () => {
        result.current[1](2);
        await Promise.resolve();
      });

      expect(ownSetActive).toHaveBeenCalledWith({ id: 2 });
    });

    it(`writes through ${router}.setActive with id: null when clearing the selection, instead of silently no-op'ing (advisor-caught 2026-09-01)`, async () => {
      const { result } = renderHook(() => hook());

      await act(async () => {
        result.current[1](null);
        await Promise.resolve();
      });

      expect(ownSetActive).toHaveBeenCalledWith({ id: null });
    });

    it("invalidates every downstream query on a successful activation, not just the settings pointer", () => {
      renderHook(() => hook());

      act(() => {
        setActiveOnSuccess?.();
      });

      expect(invalidate.appSettingsList).toHaveBeenCalled();
      expect(ownInvalidate).toHaveBeenCalled();
      expect(invalidate.contribution).toHaveBeenCalled();
      expect(invalidate.paycheck).toHaveBeenCalled();
      expect(invalidate.projection).toHaveBeenCalled();
      expect(invalidate.retirement).toHaveBeenCalled();
      expect(invalidate.brokerage).toHaveBeenCalled();
      expect(invalidate.budget).toHaveBeenCalled();
      expect(invalidate.savings).toHaveBeenCalled();
      expect(invalidate.contributionAccounts).toHaveBeenCalled();
    });
  },
);
