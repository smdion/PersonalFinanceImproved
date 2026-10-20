/** Compare Plans — one column per picked Plan, figured with its profiles. */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));

const plans = vi.fn();
vi.mock("@/lib/hooks/use-plans", () => ({ usePlans: () => plans() }));
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
      activeIds: { salary: 1, contribution: 2, budget: 3, retirement: 4 },
      planInUse: null,
      apply,
    });
    budgetQuery.mockReturnValue({
      data: { netMonthlyIncome: 5000, weightedAnnualTotal: 48000 },
      isLoading: false,
    });
    projectionQuery.mockReturnValue({
      data: {
        result: { sustainableWithdrawal: 80000, portfolioDepletionAge: null },
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
    expect(projectionQuery).toHaveBeenCalledWith(
      expect.objectContaining({
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
});
