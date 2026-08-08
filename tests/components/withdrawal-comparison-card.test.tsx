import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WithdrawalComparisonCard } from "@/components/cards/withdrawal-comparison";

// Smoke test for WithdrawalComparisonCard. Follows the leaf-component smoke
// pattern used elsewhere (e.g. networth-sections-smoke.test.tsx): mock
// HelpTip/StrategyGuideButton (noisy) and recharts (heavy, canvas-less in
// jsdom).

vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));
vi.mock("@/components/cards/strategy-guide-panel", () => ({
  StrategyGuideButton: () => null,
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: ({ name }: { name?: string }) => <div data-testid="line">{name}</div>,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

const mockAnalyzerQuery = vi.fn();
vi.mock("@/lib/trpc", () => ({
  trpc: {
    projection: {
      analyzeStrategy: {
        useQuery: (...args: unknown[]) => mockAnalyzerQuery(...args),
      },
    },
  },
}));

const strategies = [
  {
    strategy: "fixed",
    label: "Fixed Withdrawal",
    shortLabel: "Fixed",
    portfolioDepletionAge: null,
    sustainableWithdrawal: 40000,
    year1Withdrawal: 40000,
    avgAnnualWithdrawal: 41000,
    minAnnualWithdrawal: 38000,
    maxAnnualWithdrawal: 44000,
    endBalance: 500000,
    legacyAmount: 500000,
    successRate: 0.95,
    spendingStabilityRate: 0.9,
    budgetStabilityRate: 0.85,
    yearByYear: [
      { age: 65, withdrawal: 40000, endBalance: 900000 },
      { age: 66, withdrawal: 41000, endBalance: 870000 },
    ],
  },
  {
    strategy: "guardrails",
    label: "Guyton-Klinger Guardrails",
    shortLabel: "Guardrails",
    portfolioDepletionAge: 88,
    sustainableWithdrawal: 42000,
    year1Withdrawal: 42000,
    avgAnnualWithdrawal: 40000,
    minAnnualWithdrawal: 30000,
    maxAnnualWithdrawal: 48000,
    endBalance: 0,
    legacyAmount: 0,
    successRate: 0.6,
    spendingStabilityRate: null,
    budgetStabilityRate: null,
    yearByYear: [{ age: 65, withdrawal: 42000, endBalance: 850000 }],
  },
];

function baseProps(
  overrides: Partial<
    React.ComponentProps<typeof WithdrawalComparisonCard>
  > = {},
) {
  return {
    strategies,
    activeStrategy: "fixed",
    retirementAge: 65,
    dollarMode: "nominal" as const,
    onDollarModeChange: vi.fn(),
    inflationRate: 0.03,
    currentAge: 45,
    ...overrides,
  };
}

describe("WithdrawalComparisonCard", () => {
  beforeEach(() => {
    mockAnalyzerQuery.mockReturnValue({ isLoading: false, data: undefined });
  });

  it("renders nothing when there are no strategies", () => {
    const { container } = render(
      <WithdrawalComparisonCard {...baseProps({ strategies: [] })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders without crashing and shows a row per strategy", () => {
    render(<WithdrawalComparisonCard {...baseProps()} />);
    expect(
      screen.getByText("Withdrawal Strategy Comparison"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Fixed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Guardrails").length).toBeGreaterThan(0);
    expect(screen.getByText("(active)")).toBeInTheDocument();
  });

  it("shows 'Never' for a strategy with no depletion age and the age for one that has it", () => {
    render(<WithdrawalComparisonCard {...baseProps()} />);
    expect(screen.getByText("Never")).toBeInTheDocument();
    expect(screen.getByText("88")).toBeInTheDocument();
  });

  it("renders an em dash for null stability rates", () => {
    render(<WithdrawalComparisonCard {...baseProps()} />);
    // Guardrails row has null spendingStabilityRate/budgetStabilityRate.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("toggles the chart metric between Portfolio Balance and Annual Withdrawal", () => {
    render(<WithdrawalComparisonCard {...baseProps()} />);
    const withdrawalBtn = screen.getByText("Annual Withdrawal");
    fireEvent.click(withdrawalBtn);
    expect(withdrawalBtn.className).toContain("bg-blue-600");
  });

  it("calls onDollarModeChange when switching Today's $/Future $ toggle", () => {
    const onDollarModeChange = vi.fn();
    render(<WithdrawalComparisonCard {...baseProps({ onDollarModeChange })} />);
    fireEvent.click(screen.getByText("Future $"));
    expect(onDollarModeChange).toHaveBeenCalledWith("nominal");
  });

  it("opt-in analyzer: shows the 'Analyze My Strategy' button, then loading, then recommendations", () => {
    mockAnalyzerQuery.mockReturnValue({ isLoading: false, data: undefined });
    const { rerender } = render(
      <WithdrawalComparisonCard
        {...baseProps({ analyzerInput: { snapshotId: 1 } })}
      />,
    );
    expect(screen.getByText("Analyze My Strategy →")).toBeInTheDocument();

    mockAnalyzerQuery.mockReturnValue({ isLoading: true, data: undefined });
    fireEvent.click(screen.getByText("Analyze My Strategy →"));
    rerender(
      <WithdrawalComparisonCard
        {...baseProps({ analyzerInput: { snapshotId: 1 } })}
      />,
    );
    expect(
      screen.getByText("Running scenario analysis..."),
    ).toBeInTheDocument();

    mockAnalyzerQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        strategyLabel: "Fixed Withdrawal",
        baseline: { successRate: 0.9, stabilityRate: 0.8 },
        recommendations: [
          {
            label: "Withdrawal Rate",
            currentValue: "4%",
            adjustedValue: "3.5%",
            successRate: 0.95,
            successDelta: 0.05,
            stabilityRate: 0.85,
            stabilityDelta: 0.05,
          },
        ],
      },
    });
    rerender(
      <WithdrawalComparisonCard
        {...baseProps({ analyzerInput: { snapshotId: 1 } })}
      />,
    );
    expect(
      screen.getByText("Strategy Analysis — Fixed Withdrawal"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Withdrawal Rate: 4% → 3.5%/)).toBeInTheDocument();
  });
});
