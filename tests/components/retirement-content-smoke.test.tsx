import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Smoke test for RetirementContent — asserts the 3 tabs render, key KPI labels
// appear (rendered via the mocked ProjectionCard), and tab switching works.
// Child components are stubbed so we don't pull in recharts or hit the engine.

vi.mock("@/components/cards/projection", () => ({
  ProjectionCard: () => (
    <div data-testid="projection-card">
      <div>PORTFOLIO SURVIVAL</div>
      <div>NEST EGG AT RETIREMENT</div>
      <div>COAST FIRE</div>
    </div>
  ),
}));

vi.mock("@/components/cards/withdrawal-comparison", () => ({
  WithdrawalComparisonCard: () => (
    <div data-testid="withdrawal-comparison">Comparison</div>
  ),
}));

vi.mock("@/components/cards/plan-health", () => ({
  PlanHealthCard: () => (
    <div data-testid="plan-health">Plan Health Content</div>
  ),
}));

vi.mock("@/components/cards/strategy-guide-panel", () => ({
  StrategyGuideButton: () => null,
}));

vi.mock("@/components/cards/dashboard/utils", () => ({
  CardBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({
    children,
    title,
  }: {
    children: React.ReactNode;
    title?: React.ReactNode;
  }) => (
    <div data-testid="card">
      {title && <div>{title}</div>}
      {children}
    </div>
  ),
}));

vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));
vi.mock("@/components/ui/inline-edit", () => ({
  InlineEdit: ({ value }: { value: string }) => <span>{value}</span>,
  InlineSelect: ({ value }: { value: string }) => <span>{value}</span>,
}));
vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/components/ui/empty-state", () => ({
  EmptyState: ({ message }: { message: string }) => <div>{message}</div>,
}));
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
  SkeletonChart: () => <div data-testid="skeleton-chart" />,
}));

vi.mock("@/lib/hooks/use-debounced-value", () => ({
  useDebouncedValue: <T,>(v: T) => v,
}));
vi.mock("@/lib/hooks/use-salary-overrides", () => ({
  useSalaryOverrides: () => [],
}));
vi.mock("@/lib/hooks/use-persisted-setting", () => ({
  usePersistedSetting: <T,>(_key: string, initial: T) => [initial, vi.fn()],
}));
vi.mock("@/lib/hooks/use-active-contrib-profile", () => ({
  useActiveContribProfile: () => [null, vi.fn()],
}));

const mockSettings = {
  personId: 1,
  retirementAge: 65,
  endAge: 95,
  returnAfterRetirement: "0.05",
  annualInflation: "0.03",
  salaryAnnualIncrease: "0.03",
  salaryCap: null,
  withdrawalStrategy: "fixed",
  withdrawalRate: "0.04",
  filingStatus: "single",
  postRetirementInflation: "0.03",
};

const mockProjectionData = {
  settings: mockSettings,
  people: [{ id: 1, name: "Sean", birthYear: 1990 }],
  perPersonSettings: [
    {
      personId: 1,
      name: "Sean",
      birthYear: 1990,
      retirementAge: 65,
      endAge: 95,
    },
  ],
  returnRateSummary: null,
  selectedScenario: null,
  combinedSalary: 100000,
  accumulationBudgetProfileId: null,
  accumulationBudgetColumn: 0,
  decumulationBudgetProfileId: null,
  decumulationBudgetColumn: 0,
  budgetProfileSummaries: [],
  planHealth: null,
  result: { projectionByYear: [] },
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      retirement: { invalidate: vi.fn() },
      projection: {
        invalidate: vi.fn(),
        computeProjection: {
          cancel: vi.fn(),
          setData: vi.fn(),
        },
      },
    }),
    contributionProfile: {
      list: { useQuery: () => ({ data: [] }) },
    },
    networth: {
      listSnapshotTotals: { useQuery: () => ({ data: [] }) },
    },
    projection: {
      computeProjection: {
        useQuery: () => ({
          data: mockProjectionData,
          isLoading: false,
          isFetching: false,
          error: null,
        }),
      },
      computeStrategyComparison: {
        useQuery: () => ({ data: null, isLoading: false }),
      },
    },
    settings: {
      retirementSettings: {
        upsert: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
    },
  },
}));

describe("RetirementContent smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the 3 main tabs", async () => {
    const { RetirementContent } =
      await import("@/app/(dashboard)/retirement/retirement-content");
    render(<RetirementContent />);
    expect(
      screen.getByRole("button", { name: "Projection" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Strategy Comparison" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Plan Health" }),
    ).toBeInTheDocument();
  });

  it("renders KPI card labels on the default Projection tab", async () => {
    const { RetirementContent } =
      await import("@/app/(dashboard)/retirement/retirement-content");
    render(<RetirementContent />);
    expect(screen.getByText("PORTFOLIO SURVIVAL")).toBeInTheDocument();
    expect(screen.getByText("NEST EGG AT RETIREMENT")).toBeInTheDocument();
    expect(screen.getByText("COAST FIRE")).toBeInTheDocument();
  });

  it("switches between tabs", async () => {
    const { RetirementContent } =
      await import("@/app/(dashboard)/retirement/retirement-content");
    render(<RetirementContent />);
    // Default tab shows projection card
    expect(screen.getByTestId("projection-card")).toBeInTheDocument();

    // Switch to Plan Health tab
    fireEvent.click(screen.getByRole("button", { name: "Plan Health" }));
    expect(screen.getByTestId("plan-health")).toBeInTheDocument();
    expect(screen.queryByTestId("projection-card")).toBeNull();
  });
});
