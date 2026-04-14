import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Smoke test for the Tools (Relocation Analysis) page. Asserts the main
// relocation form fields render, the projection comparison table header
// renders, and the year-adjustments panel header renders. Exercises the
// save-scenario mutation path.

const saveMutate = vi.fn();

vi.mock("@/lib/hooks/use-debounced-value", () => ({
  useDebouncedValue: <T,>(v: T) => v,
}));

vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
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
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
  SkeletonChart: () => <div data-testid="skeleton-chart" />,
}));
vi.mock("@/components/ui/toggle", () => ({
  Toggle: ({ label }: { label: string }) => <label>{label}</label>,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));

const mockRelocData = {
  budgetInfo: {
    profiles: [
      {
        id: 1,
        name: "Default",
        isActive: true,
        columnLabels: ["Base"],
        columnTotals: [4000],
        columnMonths: null,
        weightedAnnualTotal: null,
      },
    ],
  },
  result: {
    monthlyExpenseDelta: 500,
    percentExpenseIncrease: 12,
    additionalNestEggNeeded: 150000,
    currentFiTarget: 1000000,
    relocationFiTarget: 1150000,
    savingsRateDrop: 0.02,
    currentSavingsRate: 0.25,
    relocationSavingsRate: 0.23,
    fiAgeDelay: 2,
    currentFiAge: 55,
    relocationFiAge: 57,
    earliestRelocateAge: 45,
    recommendedPortfolioToRelocate: 800000,
    warnings: [],
    totalLargePurchasePortfolioHit: 0,
    steadyStateMonthlyFromPurchases: 0,
    projectionByYear: [
      {
        year: 2026,
        age: 40,
        currentContribution: 20000,
        currentBalance: 500000,
        relocationContribution: 20000,
        relocationBalance: 500000,
        delta: 0,
        relocationExpenses: 54000,
        hasAdjustment: false,
        largePurchaseImpact: 0,
      },
    ],
  },
  currentContribProfile: null,
  relocationContribProfile: null,
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      settings: {
        relocationScenarios: { list: { invalidate: vi.fn() } },
      },
    }),
    settings: {
      relocationScenarios: {
        list: { useQuery: () => ({ data: [] }) },
        save: {
          useMutation: () => ({ mutate: saveMutate, isPending: false }),
        },
        delete: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
      },
    },
    budget: {
      listProfiles: {
        useQuery: () => ({
          data: [
            {
              id: 1,
              name: "Default",
              isActive: true,
              columnLabels: ["Base"],
              columnTotals: [4000],
            },
          ],
        }),
      },
    },
    contributionProfile: {
      list: { useQuery: () => ({ data: [] }) },
    },
    projection: {
      computeProjection: {
        useQuery: () => ({
          data: { people: [{ id: 1, name: "Sean", birthYear: 1990 }] },
        }),
      },
    },
    retirement: {
      computeRelocationAnalysis: {
        useQuery: () => ({ data: mockRelocData, isLoading: false }),
      },
    },
  },
}));

describe("ToolsPage smoke", () => {
  beforeEach(() => {
    saveMutate.mockClear();
  });

  it("renders relocation form fields and key section headers", async () => {
    const { default: ToolsPage } = await import("@/app/(dashboard)/tools/page");
    render(<ToolsPage />);

    // Page header
    expect(screen.getByText("Tools")).toBeInTheDocument();

    // Form fields for current and target location
    expect(screen.getByText("Current Budget")).toBeInTheDocument();
    expect(screen.getByText("Relocation Budget")).toBeInTheDocument();

    // Year-adjustments panel header
    expect(
      screen.getByText("Year-by-Year Expense Adjustments"),
    ).toBeInTheDocument();

    // Portfolio projection comparison table header
    expect(
      screen.getByText("Portfolio Projection Comparison"),
    ).toBeInTheDocument();
  });

  it("invokes the save-scenario mutation path", async () => {
    const { default: ToolsPage } = await import("@/app/(dashboard)/tools/page");
    render(<ToolsPage />);

    // Click the top-level Save button (no selectedScenarioId → opens dialog)
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    // A Name input appears inside the save dialog
    const nameInput = screen.getByPlaceholderText(/Scenario name/i);
    fireEvent.change(nameInput, { target: { value: "My Move" } });

    // There are now 2 Save buttons: the top one and the dialog one — click
    // the dialog Save (second occurrence) to trigger the mutation.
    const saveBtns = screen.getAllByRole("button", { name: /^Save$/i });
    fireEvent.click(saveBtns[saveBtns.length - 1]!);

    expect(saveMutate).toHaveBeenCalled();
  });
});
