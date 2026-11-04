/** Compare Plans — one column per picked Plan, figured with its profiles. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));

vi.mock("@/lib/hooks/use-plan-engine-input", () => ({
  usePlanEngineInput: () => ({
    input: {
      selection: { contribution: 20, salary: 10 },
      decumulationDefaults: {},
    },
    ready: true,
    ids: {
      contributionProfileId: 20,
      salaryProfileId: 10,
      retirementProfileId: null,
      snapshotId: null,
    },
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
vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

import { ComparePlans } from "@/components/plans/compare-plans";
import { queryCalls, resetTrpcMock, setQuery } from "./trpc-mock";

const BUDGET = "budget.computeActiveSummary";
const PROJECTION = "projection.computeProjection";

beforeEach(() => {
  resetTrpcMock();
  setQuery("contributionProfile.list", [{ id: 2, name: "Max 401k" }]);
  setQuery("salaryProfile.list", [{ id: 1, name: "Raise" }]);
  setQuery("retirement.retirementProfiles.list", [
    { id: 4, name: "Retire 60" },
  ]);
});

/** Each Plan's budget and projection answers. */
function figures() {
  setQuery(BUDGET, { netMonthlyIncome: 5000, weightedAnnualTotal: 48000 });
  setQuery(PROJECTION, {
    result: { sustainableWithdrawal: 80000, projectionByYear: [] },
  });
}

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
    figures();
    render(<ComparePlans />);
    expect(queryCalls(BUDGET)).toContainEqual(
      expect.objectContaining({
        profileId: 3,
        contributionProfile: expect.objectContaining({ localSelectionId: 2 }),
        salaryProfile: expect.objectContaining({ localSelectionId: 1 }),
      }),
    );
    // The dashboard's input, with this Plan's profiles where they differ.
    expect(queryCalls(PROJECTION)).toContainEqual(
      expect.objectContaining({
        decumulationDefaults: {},
        selection: {
          contribution: 2,
          salary: 1,
          retirement: 4,
          accumulationBudget: { profileId: 3 },
        },
      }),
    );
    expect(screen.getByText("Max 401k")).toBeInTheDocument();
    expect(screen.getByText("$60,000")).toBeInTheDocument(); // take-home
    expect(screen.getByText("$12,000")).toBeInTheDocument(); // left over
    expect(screen.getByText("through the plan")).toBeInTheDocument();
  });
  it("the Plan in use runs exactly the dashboard's projection (same cached run)", () => {
    // The earlier test's answers stay registered, as they did before.
    figures();
    plans.mockReturnValue({
      plans: [{ ...plan, salaryProfileId: 10, contributionProfileId: 20 }],
      activeIds: { salary: 10, contribution: 20, budget: 3, retirement: 4 },
      planInUse: { id: 9 },
      apply,
    });
    render(<ComparePlans />);
    expect(queryCalls(PROJECTION)).toContainEqual({
      selection: { contribution: 20, salary: 10 },
      decumulationDefaults: {},
    });
  });
});
