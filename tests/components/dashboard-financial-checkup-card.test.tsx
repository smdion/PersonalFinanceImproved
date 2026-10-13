import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import {
  evaluateMilestones,
  type MilestoneInput,
  type MilestoneResult,
} from "@/lib/pure/milestones";
import { makeInput } from "../fixtures/milestones";

// Direct smoke test for
// src/components/cards/dashboard/financial-checkup-card.tsx: milestone rows
// come from the Milestones engine (run for real on a synthetic input), the
// savings-rate row from the contribution summary and the shared switches.

vi.mock("@/components/ui/help-tip", () => ({
  HelpTip: () => null,
}));
vi.mock("@/lib/context/scenario-context", () => ({
  useScenario: () => ({ viewMode: "projected" as const, isInScenario: false }),
}));
vi.mock("@/lib/hooks/use-salary-overrides", () => ({
  useActiveSalaries: () => [],
}));
vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role: "viewer", name: "Test", permissions: [] }),
  isAdmin: (u: { role: string }) => u.role === "admin",
  hasPermission: () => true,
}));
vi.mock("@/lib/hooks/use-persisted-setting", () => ({
  usePersistedSetting: (key: string, defaultValue: unknown) => {
    if (key === "high_income_threshold") return [200000, vi.fn()];
    return [defaultValue, vi.fn()];
  },
}));
vi.mock("@/lib/hooks/use-year-end-targeting", () => ({
  useYearEndTargetingInput: () => ({}),
}));

let contribsQuery: { data: unknown; isLoading: boolean; error: unknown };
let milestonesState: {
  isLoading: boolean;
  projectionLoading: boolean;
  error: boolean;
  input: MilestoneInput | null;
  results: MilestoneResult[];
};
vi.mock("@/lib/hooks/use-milestones", () => ({
  useContributionSummaryInput: () => ({}),
  useMilestones: () => milestonesState,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      settings: { appSettings: { list: { invalidate: vi.fn() } } },
    }),
    contribution: { computeSummary: { useQuery: () => contribsQuery } },
    settings: {
      appSettings: {
        list: { useQuery: () => ({ data: [] }) },
        upsert: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
      },
    },
  },
}));

import { FinancialCheckupCard } from "@/components/cards/dashboard/financial-checkup-card";

const withData = (data: unknown) => ({ data, isLoading: false, error: null });

const baseContribs = {
  people: [
    {
      accountTypes: [
        {
          employerMatch: 3000,
          parentCategory: "Retirement",
          employeeContrib: 30000,
          tradContrib: 20000,
          taxFreeContrib: 10000,
          afterTaxContrib: 0,
          hsaContrib: 0,
        },
      ],
      result: {},
      totalCompensation: 150000,
      salary: 150000,
      totals: {
        views: {
          projected: {
            retirementWithoutMatch: 30000,
            retirementWithMatch: 33000,
            portfolioWithoutMatch: 0,
            portfolioWithMatch: 0,
            compensation: 150000,
          },
        },
      },
    },
  ],
};

function withMilestones(input: MilestoneInput) {
  milestonesState = {
    isLoading: false,
    projectionLoading: false,
    error: false,
    input,
    results: evaluateMilestones(input),
  };
}

describe("FinancialCheckupCard smoke", () => {
  it("renders a loading card while the milestones are pending", () => {
    milestonesState = {
      isLoading: true,
      error: false,
      input: null,
      results: [],
    };
    contribsQuery = withData(baseContribs);
    render(<FinancialCheckupCard />);
    expect(screen.getByText("Financial Checkup")).toBeInTheDocument();
  });

  it("renders an error card when a query errors", () => {
    milestonesState = {
      isLoading: false,
      error: true,
      input: null,
      results: [],
    };
    contribsQuery = withData(baseContribs);
    render(<FinancialCheckupCard />);
    expect(screen.getByText("Failed to load")).toBeInTheDocument();
  });

  it("shows the emergency fund months from the engine", () => {
    withMilestones(makeInput({ efundMonths: 4.5 }));
    contribsQuery = withData(baseContribs);
    render(<FinancialCheckupCard />);
    expect(screen.getByText("Emergency Fund")).toBeInTheDocument();
    expect(screen.getByText("4.5 mo covered")).toBeInTheDocument();
  });

  it("shows the full match as captured", () => {
    withMilestones(makeInput({ match: { captured: 3000, available: 3000 } }));
    contribsQuery = withData(baseContribs);
    render(<FinancialCheckupCard />);
    expect(screen.getByText("Employer Match")).toBeInTheDocument();
    expect(screen.getByText("$3,000.00/yr captured")).toBeInTheDocument();
  });

  it("flags match left on the table", () => {
    withMilestones(makeInput({ match: { captured: 2000, available: 3000 } }));
    contribsQuery = withData(baseContribs);
    render(<FinancialCheckupCard />);
    expect(screen.getByText("$1,000.00/yr missed")).toBeInTheDocument();
  });

  it("judges high-interest debt, not mortgage prepayment", () => {
    withMilestones(makeInput());
    contribsQuery = withData(baseContribs);
    render(<FinancialCheckupCard />);
    expect(screen.getByText("High-Interest Debt")).toBeInTheDocument();
    expect(
      screen.getByText("No debt besides the mortgage"),
    ).toBeInTheDocument();
  });

  it("shows the FI pace from the projection", () => {
    withMilestones(makeInput());
    contribsQuery = withData(baseContribs);
    render(<FinancialCheckupCard />);
    expect(screen.getByText("FI Progress")).toBeInTheDocument();
    expect(screen.getByText(/On pace for age \d+/)).toBeInTheDocument();
  });

  it("links to Recommendations with the count and counts what's on track", () => {
    withMilestones(makeInput());
    contribsQuery = withData(baseContribs);
    render(<FinancialCheckupCard />);
    expect(screen.getByText(/\/\d+ on track/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /recommendation/i });
    expect(link).toHaveAttribute("href", "/recommendations");
    expect(link.textContent).toMatch(/^\d+ recommendations? →$/);
  });

  it("a savings rate that rounds to the target is green", () => {
    withMilestones(makeInput());
    // 24.96% retirement-only without the match: rounds to 25%.
    contribsQuery = withData({
      people: [
        {
          ...baseContribs.people[0],
          totals: {
            views: {
              projected: {
                retirementWithoutMatch: 37440,
                retirementWithMatch: 40440,
                portfolioWithoutMatch: 0,
                portfolioWithMatch: 0,
                compensation: 150000,
              },
            },
          },
        },
      ],
    });
    render(<FinancialCheckupCard />);
    fireEvent.click(screen.getByRole("button", { name: /Savings Rate/ }));
    fireEvent.click(screen.getByRole("button", { name: "Excl. match" }));
    const row = screen.getByRole("button", { name: /Savings Rate/ });
    expect(within(row).getByText("25%")).toBeInTheDocument();
    expect(row.querySelector(".text-green-500")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Incl. match" }));
  });

  it("expands the Savings Rate row into what it's made of", () => {
    withMilestones(makeInput());
    contribsQuery = withData(baseContribs);
    render(<FinancialCheckupCard />);
    // Below the high-income threshold: the match counts by default.
    expect(screen.getByText("22%")).toBeInTheDocument();
    expect(screen.queryByText("Employer match")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Savings Rate/ }));
    expect(screen.getByText("Employer match")).toBeInTheDocument();
    expect(screen.getByText("Roth")).toBeInTheDocument();
    const row = () => screen.getByRole("button", { name: /Savings Rate/ });
    fireEvent.click(screen.getByRole("button", { name: "Excl. match" }));
    expect(within(row()).getByText("20%")).toBeInTheDocument();
    expect(screen.queryByText("Employer match")).toBeNull();
    // Portfolio toggle: the fixture has no Portfolio money, so the rate holds
    // and the row says what's counted.
    fireEvent.click(screen.getByRole("button", { name: "Excl. portfolio" }));
    expect(within(row()).getByText("20%")).toBeInTheDocument();
    expect(screen.getByText("retirement only")).toBeInTheDocument();
    // The switches are shared app-wide (a module store): put them back.
    fireEvent.click(screen.getByRole("button", { name: "Incl. match" }));
    fireEvent.click(screen.getByRole("button", { name: "Incl. portfolio" }));
  });
});
