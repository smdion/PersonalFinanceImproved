/** Compare Plans — one column per picked Plan, figured with its profiles. */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));

vi.mock("@/lib/hooks/use-dashboard-projection", () => ({
  useDashboardEngineInput: () => ({
    contributionProfileId: 20,
    salaryProfileId: 10,
    decumulationDefaults: {},
  }),
}));
vi.mock("@/components/ui/confirm-dialog", () => ({ confirmWithDiff: vi.fn() }));

const plans = vi.fn();
vi.mock("@/lib/hooks/use-plans", () => ({
  usePlans: () => plans(),
  useConfirmApplyPlan: () => vi.fn(),
}));
vi.mock("@/lib/hooks/use-budget-profiles-list", () => ({
  useBudgetProfilesList: () => ({ data: [{ id: 3, name: "Lean" }] }),
}));
const budgetQuery = vi.fn();
const projectionQuery = vi.fn();
vi.mock("@/lib/trpc", () => ({
  trpc: {
    contributionProfile: {
      list: { useQuery: () => ({ data: [{ id: 2, name: "Max 401k" }] }) },
    },
    salaryProfile: {
      list: { useQuery: () => ({ data: [{ id: 1, name: "Raise" }] }) },
    },
    retirement: {
      retirementProfiles: {
        list: { useQuery: () => ({ data: [{ id: 4, name: "Retire 60" }] }) },
      },
    },
    budget: {
      computeActiveSummary: { useQuery: (i: unknown) => budgetQuery(i) },
    },
    projection: {
      computeProjection: { useQuery: (i: unknown) => projectionQuery(i) },
    },
  },
}));

import { ComparePlans } from "@/components/plans/compare-plans";

const apply = { mutate: vi.fn(), isPending: false };
const plan = {
  id: 9,
  name: "Lean year",
  salaryProfileId: 1,
  contributionProfileId: 2,
  budgetProfileId: 3,
  retirementProfileId: 4,
};

describe("ComparePlans", () => {
  it("explains how to make a Plan when there are none", () => {
    plans.mockReturnValue({
      plans: [],
      activeIds: {},
      planInUse: null,
      apply,
    });
    render(<ComparePlans />);
    expect(screen.getByText(/No Plans yet/)).toBeInTheDocument();
  });

  it("figures each Plan with its own profiles", () => {
    plans.mockReturnValue({
      plans: [plan],
      // Every kind differs from the Plan's, so each is changed in the input.
      activeIds: { salary: 10, contribution: 20, budget: 30, retirement: 40 },
      planInUse: null,
      apply,
    });
    budgetQuery.mockReturnValue({
      data: { netMonthlyIncome: 5000, weightedAnnualTotal: 48000 },
      isLoading: false,
    });
    projectionQuery.mockReturnValue({
      data: {
        result: { sustainableWithdrawal: 80000, projectionByYear: [] },
      },
      isLoading: false,
    });
    render(<ComparePlans />);
    expect(budgetQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: 3,
        contributionProfile: expect.objectContaining({ localSelectionId: 2 }),
        salaryProfile: expect.objectContaining({ localSelectionId: 1 }),
      }),
    );
    // The dashboard's input, with this Plan's profiles where they differ.
    expect(projectionQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        decumulationDefaults: {},
        contributionProfileId: 2,
        salaryProfileId: 1,
        retirementProfileId: 4,
        accumulationBudgetProfileId: 3,
      }),
    );
    expect(screen.getByText("Max 401k")).toBeInTheDocument();
    expect(screen.getByText("$60,000")).toBeInTheDocument(); // take-home
    expect(screen.getByText("$12,000")).toBeInTheDocument(); // left over
    expect(screen.getByText("through the plan")).toBeInTheDocument();
  });
  it("the Plan in use runs exactly the dashboard's projection (same cached run)", () => {
    projectionQuery.mockClear();
    plans.mockReturnValue({
      plans: [{ ...plan, salaryProfileId: 10, contributionProfileId: 20 }],
      activeIds: { salary: 10, contribution: 20, budget: 3, retirement: 4 },
      planInUse: { id: 9 },
      apply,
    });
    render(<ComparePlans />);
    expect(projectionQuery).toHaveBeenCalledWith({
      contributionProfileId: 20,
      salaryProfileId: 10,
      decumulationDefaults: {},
    });
  });
});
