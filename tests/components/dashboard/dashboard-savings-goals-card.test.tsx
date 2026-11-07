import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Direct smoke test for
// src/components/dashboard/savings-goals-card.tsx — e-fund progress
// + per-goal funded/on-track/shortfall/accumulating status derivation.
// No direct coverage before this (tests/components/dashboard/dashboard.test.tsx mocks
// the whole card out at the page level).

vi.mock("@/lib/hooks/use-persisted-setting", () => ({
  usePersistedSetting: (_key: string, defaultValue: unknown) => [
    defaultValue,
    vi.fn(),
  ],
}));

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("../trpc-mock")).trpc,
}));

import { SavingsGoalsCard } from "@/components/dashboard/savings-goals-card";
import {
  resetTrpcMock,
  setQuery,
  setQueryState,
  type MockOutput,
} from "../trpc-mock";

const SUMMARY = "savings.computeSummary";
const REIMB = "savings.listEfundReimbursements";
const summary = (data: ReturnType<typeof mkData>) =>
  // mkData's goal rows are partial and keep the fixture's own field types.
  setQuery(SUMMARY, data as MockOutput<typeof SUMMARY>);

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
  beforeEach(() => {
    resetTrpcMock();
  });

  it("renders a loading card while the query is pending", () => {
    setQueryState(SUMMARY, { isLoading: true });
    setQuery(REIMB, undefined);
    render(<SavingsGoalsCard />);
    expect(screen.getByText("Savings Goals")).toBeInTheDocument();
  });

  it("renders an error card when the query fails", () => {
    setQueryState(SUMMARY, { error: new Error("x") });
    setQuery(REIMB, undefined);
    render(<SavingsGoalsCard />);
    expect(screen.getByText("Failed to load: x")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("renders the emergency fund progress section with tier toggle and needed amount", () => {
    summary(mkData());
    setQuery(REIMB, undefined);
    render(<SavingsGoalsCard />);
    expect(screen.getByText("Income Replacement")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lean" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fat" })).toBeInTheDocument();
    expect(screen.getByText("Current Fund")).toBeInTheDocument();
    // neededAfterRepay = 5000 > 0.005 -> shows the raw currency amount
    expect(screen.getByText("$5,000.00")).toBeInTheDocument();
  });

  it("marks a fixed-target goal as Funded when current >= target", () => {
    summary(mkData());
    setQuery(REIMB, undefined);
    render(<SavingsGoalsCard />);
    // Vacation Fund: current 6000 >= target 5000 -> Funded
    expect(screen.getByText("Vacation Fund")).toBeInTheDocument();
    // The name opens that goal on Savings.
    expect(
      screen.getByText("Vacation Fund").closest("a")?.getAttribute("href"),
    ).toBe("/savings?focus=savingsGoal&focusId=1");
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
    summary(
      mkData({
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
    );
    setQuery(REIMB, undefined);
    render(<SavingsGoalsCard />);
    expect(screen.getByText("Car Repair")).toBeInTheDocument();
    expect(screen.getByText(/\$6,000\.00 needed/)).toBeInTheDocument();
  });

  it("shows the pending reimbursement row when reimbursements exist", () => {
    summary(mkData());
    setQuery(REIMB, { total: 250 });
    render(<SavingsGoalsCard />);
    expect(screen.getByText("Pending Reimb.")).toBeInTheDocument();
    expect(screen.getByText("+$250.00")).toBeInTheDocument();
  });

  it("renders nothing extra (no e-fund block) when monthsCovered is null", () => {
    summary(mkData({ efund: { ...baseEfund, monthsCovered: null } }));
    setQuery(REIMB, undefined);
    render(<SavingsGoalsCard />);
    expect(screen.queryByText("Income Replacement")).toBeNull();
  });
});
