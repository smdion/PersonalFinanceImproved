import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Direct smoke test for
// src/components/cards/dashboard/savings-goals-card.tsx — e-fund progress
// + per-goal funded/on-track/shortfall/accumulating status derivation.
// No direct coverage before this (tests/components/dashboard.test.tsx mocks
// the whole card out at the page level).

vi.mock("@/lib/hooks/use-persisted-setting", () => ({
  usePersistedSetting: (_key: string, defaultValue: unknown) => [
    defaultValue,
    vi.fn(),
  ],
}));

let savingsQuery: { data: unknown; isLoading: boolean; error: unknown };
let reimbQuery: { data: unknown };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    savings: {
      computeSummary: { useQuery: () => savingsQuery },
      listEfundReimbursements: { useQuery: () => reimbQuery },
    },
  },
}));

import { SavingsGoalsCard } from "@/components/cards/dashboard/savings-goals-card";

const loading = { data: undefined, isLoading: true, error: null };

const baseEfund = {
  monthsCovered: 4,
  monthsCoveredWithRepay: null,
  progress: 0.8,
  targetMonths: 5,
  targetAmount: 25000,
  trueBalance: 20000,
  rawBalance: 20000,
  outstandingSelfLoans: 0,
  balanceWithRepay: 20000,
  neededAfterRepay: 5000,
};

const fundedGoal = {
  id: 1,
  name: "Vacation Fund",
  isActive: true,
  targetAmount: "5000",
  targetMode: "fixed",
  targetDate: null,
  monthlyContribution: "0",
  isEmergencyFund: false,
  parentGoalId: null,
};

const efundGoal = {
  id: 2,
  name: "Emergency Fund",
  isActive: true,
  targetAmount: null,
  targetMode: "ongoing",
  targetDate: null,
  monthlyContribution: "500",
  isEmergencyFund: true,
  parentGoalId: null,
};

function mkData(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    savings: {
      goals: [
        {
          goalId: 1,
          name: "Vacation Fund",
          current: 6000,
          target: 5000,
          monthlyAllocation: 0,
        },
        {
          goalId: 2,
          name: "Emergency Fund",
          current: 20000,
          target: 0,
          monthlyAllocation: 500,
        },
      ],
    },
    efund: baseEfund,
    budgetTierLabels: ["Lean", "Fat"],
    efundTierIndex: 0,
    goals: [fundedGoal, efundGoal],
    plannedTransactions: [],
    allocationOverrides: [],
    ...overrides,
  };
}

describe("SavingsGoalsCard smoke", () => {
  it("renders a loading card while the query is pending", () => {
    savingsQuery = loading;
    reimbQuery = { data: undefined };
    render(<SavingsGoalsCard />);
    expect(screen.getByText("Savings Goals")).toBeInTheDocument();
  });

  it("renders an error card when the query fails", () => {
    savingsQuery = { data: undefined, isLoading: false, error: new Error("x") };
    reimbQuery = { data: undefined };
    render(<SavingsGoalsCard />);
    expect(screen.getByText("Failed to load")).toBeInTheDocument();
  });

  it("renders the emergency fund progress section with tier toggle and needed amount", () => {
    savingsQuery = { data: mkData(), isLoading: false, error: null };
    reimbQuery = { data: undefined };
    render(<SavingsGoalsCard />);
    expect(screen.getByText("Income Replacement")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lean" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fat" })).toBeInTheDocument();
    expect(screen.getByText("Current Fund")).toBeInTheDocument();
    // neededAfterRepay = 5000 > 0.005 -> shows the raw currency amount
    expect(screen.getByText("$5,000.00")).toBeInTheDocument();
  });

  it("marks a fixed-target goal as Funded when current >= target", () => {
    savingsQuery = { data: mkData(), isLoading: false, error: null };
    reimbQuery = { data: undefined };
    render(<SavingsGoalsCard />);
    // Vacation Fund: current 6000 >= target 5000 -> Funded
    expect(screen.getByText("Vacation Fund")).toBeInTheDocument();
    expect(screen.getAllByText("Funded").length).toBeGreaterThan(0);
  });

  it("shows a shortfall amount for a past-due underfunded fixed goal", () => {
    const shortfallGoal = {
      ...fundedGoal,
      id: 3,
      name: "Car Repair",
      targetAmount: "8000",
      targetDate: "2020-01-01",
    };
    savingsQuery = {
      data: mkData({
        savings: {
          goals: [
            {
              goalId: 3,
              name: "Car Repair",
              current: 2000,
              target: 8000,
              monthlyAllocation: 0,
            },
            {
              goalId: 2,
              name: "Emergency Fund",
              current: 20000,
              target: 0,
              monthlyAllocation: 500,
            },
          ],
        },
        goals: [shortfallGoal, efundGoal],
      }),
      isLoading: false,
      error: null,
    };
    reimbQuery = { data: undefined };
    render(<SavingsGoalsCard />);
    expect(screen.getByText("Car Repair")).toBeInTheDocument();
    expect(screen.getByText(/\$6,000\.00 needed/)).toBeInTheDocument();
  });

  it("shows the pending reimbursement row when reimbursements exist", () => {
    savingsQuery = { data: mkData(), isLoading: false, error: null };
    reimbQuery = { data: { total: 250 } };
    render(<SavingsGoalsCard />);
    expect(screen.getByText("Pending Reimb.")).toBeInTheDocument();
    expect(screen.getByText("+$250.00")).toBeInTheDocument();
  });

  it("renders nothing extra (no e-fund block) when monthsCovered is null", () => {
    savingsQuery = {
      data: mkData({ efund: { ...baseEfund, monthsCovered: null } }),
      isLoading: false,
      error: null,
    };
    reimbQuery = { data: undefined };
    render(<SavingsGoalsCard />);
    expect(screen.queryByText("Income Replacement")).toBeNull();
  });
});
