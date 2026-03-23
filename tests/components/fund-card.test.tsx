import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FundCard } from "@/components/savings/fund-card";
import type { GoalProjection } from "@/components/savings/types";

vi.mock("@/components/ui/inline-edit", () => ({
  InlineEdit: ({ value }: { value: string }) => <span>{value}</span>,
}));

vi.mock("@/components/ui/confirm-dialog", () => ({
  confirm: () => Promise.resolve(true),
}));

vi.mock("@/lib/utils/format", () => ({
  formatCurrency: (n: number) => `$${Math.round(n).toLocaleString()}`,
  formatDate: (d: Date | string) => String(d),
  formatNumber: (n: number) => String(n),
}));

vi.mock("@/components/savings/fund-mini-chart", () => ({
  FundMiniChart: () => <div data-testid="mini-chart">Chart</div>,
}));

vi.mock("@/components/savings/fund-transaction-list", () => ({
  FundTransactionList: () => <div data-testid="tx-list">Transactions</div>,
}));

vi.mock("@/components/savings/fund-overrides-summary", () => ({
  FundOverridesSummary: () => <div data-testid="overrides">Overrides</div>,
}));

function makeProjection(
  overrides: Partial<GoalProjection> = {},
): GoalProjection {
  return {
    name: "Vacation Fund",
    goalId: 1,
    current: 3000,
    target: 10000,
    monthlyAllocation: 500,
    monthlyAllocations: [500, 500, 500],
    balances: [3500, 4000, 4500],
    monthEvents: [null, null, null],
    hasOverride: [false, false, false],
    ...overrides,
  };
}

function makeRawGoal(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "Vacation Fund",
    monthlyContribution: "500",
    isActive: true,
    isEmergencyFund: false,
    targetDate: "2026-12-01",
    targetAmount: "10000",
    targetMode: "fixed",
    parentGoalId: null,
    priority: 1,
    ...overrides,
  };
}

function makeSavingsGoal(overrides: Record<string, unknown> = {}) {
  return {
    goalId: 1,
    name: "Vacation Fund",
    monthlyAllocation: 500,
    current: 3000,
    target: 10000,
    progress: 0.3,
    monthsToTarget: 14,
    ...overrides,
  };
}

const defaultProps = {
  projection: makeProjection(),
  rawGoal: makeRawGoal(),
  savingsGoal: makeSavingsGoal(),
  children: [],
  savingsGoals: [makeSavingsGoal()],
  transactions: [],
  overrides: [],
  monthDates: [
    new Date("2025-04-01"),
    new Date("2025-05-01"),
    new Date("2025-06-01"),
  ],
  totalMonthlyAllocation: 500,
  fundColor: "blue",
  onGoalUpdate: vi.fn(),
  onDeleteGoal: vi.fn(),
  onDeleteTx: vi.fn(),
  goalById: new Map(),
  onAddTx: vi.fn(),
  createTxPending: false,
  onEditMonth: vi.fn(),
  onDeleteOverride: vi.fn(),
  onTimelineClick: vi.fn(),
  addingSubGoalForFund: null,
  setAddingSubGoalForFund: vi.fn(),
  newFund: {
    name: "",
    monthlyContribution: "",
    targetAmount: "",
    targetMode: "fixed" as const,
    targetDate: "",
  },
  setNewFund: vi.fn(),
  onCreateFund: vi.fn(),
  createGoalPending: false,
};

describe("FundCard", () => {
  it("renders the fund name", () => {
    render(<FundCard {...defaultProps} />);
    expect(screen.getByText("Vacation Fund")).toBeInTheDocument();
  });

  it("shows 'On track' status for fixed fund with future target date and allocation", () => {
    render(<FundCard {...defaultProps} />);
    expect(screen.getByText("On track")).toBeInTheDocument();
  });

  it("shows 'Funded' status when current >= target", () => {
    render(
      <FundCard
        {...defaultProps}
        savingsGoal={makeSavingsGoal({ current: 10000, target: 10000 })}
      />,
    );
    expect(screen.getByText("Funded")).toBeInTheDocument();
  });

  it("shows 'Needs attention' when balance goes negative", () => {
    render(
      <FundCard
        {...defaultProps}
        projection={makeProjection({ balances: [3500, -100, 4500] })}
      />,
    );
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
  });

  it("shows 'Funded' for emergency fund at target", () => {
    render(
      <FundCard
        {...defaultProps}
        rawGoal={makeRawGoal({ isEmergencyFund: true, targetMode: "ongoing" })}
        savingsGoal={makeSavingsGoal({ current: 10000, target: 10000 })}
      />,
    );
    expect(screen.getByText("Funded")).toBeInTheDocument();
  });

  it("shows 'In progress' for emergency fund with allocation below target", () => {
    render(
      <FundCard
        {...defaultProps}
        rawGoal={makeRawGoal({ isEmergencyFund: true, targetMode: "ongoing" })}
        savingsGoal={makeSavingsGoal({
          current: 5000,
          target: 10000,
          monthlyAllocation: 500,
        })}
      />,
    );
    expect(screen.getByText("In progress")).toBeInTheDocument();
  });

  it("shows 'Accumulating' for ongoing fund with allocation but no expenses", () => {
    render(
      <FundCard
        {...defaultProps}
        rawGoal={makeRawGoal({ targetMode: "ongoing", targetAmount: null })}
        savingsGoal={makeSavingsGoal({ target: 0, monthlyAllocation: 200 })}
      />,
    );
    expect(screen.getByText("Accumulating")).toBeInTheDocument();
  });

  it("shows 'Not funded' for ongoing fund with no allocation", () => {
    render(
      <FundCard
        {...defaultProps}
        rawGoal={makeRawGoal({ targetMode: "ongoing", targetAmount: null })}
        savingsGoal={makeSavingsGoal({ target: 0, monthlyAllocation: 0 })}
      />,
    );
    expect(screen.getByText("Not funded")).toBeInTheDocument();
  });

  it("renders mini chart", () => {
    render(<FundCard {...defaultProps} />);
    expect(screen.getByTestId("mini-chart")).toBeInTheDocument();
  });
});
