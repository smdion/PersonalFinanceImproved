import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Direct smoke test for
// src/components/cards/dashboard/financial-checkup-card.tsx. Aggregates 4
// separate tRPC queries (savings, contributions, mortgage, net worth) into
// a checklist of health indicators — no direct test coverage before this
// (tests/components/dashboard.test.tsx mocks the whole card out).

vi.mock("@/components/ui/help-tip", () => ({
  HelpTip: () => null,
}));
vi.mock("@/lib/context/scenario-context", () => ({
  useScenario: () => ({ viewMode: "projected" as const, isInScenario: false }),
}));
vi.mock("@/lib/hooks/use-salary-overrides", () => ({
  useActiveSalaries: () => [],
}));
vi.mock("@/lib/hooks/use-persisted-setting", () => ({
  usePersistedSetting: (key: string, defaultValue: unknown) => {
    if (key === "high_income_threshold") return [200000, vi.fn()];
    return [defaultValue, vi.fn()];
  },
}));
vi.mock("@/lib/hooks/use-fi-cache", () => ({
  useFICache: () => [null, vi.fn()],
}));
vi.mock("@/lib/hooks/use-year-end-targeting", () => ({
  useYearEndTargetingInput: () => ({}),
}));

let savingsQuery: { data: unknown; isLoading: boolean; error: unknown };
let contribsQuery: { data: unknown; isLoading: boolean; error: unknown };
let mortgageQuery: { data: unknown; isLoading: boolean; error: unknown };
let networthQuery: { data: unknown; isLoading: boolean; error: unknown };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    savings: { computeSummary: { useQuery: () => savingsQuery } },
    contribution: { computeSummary: { useQuery: () => contribsQuery } },
    mortgage: { computeActiveSummary: { useQuery: () => mortgageQuery } },
    networth: { computeSummary: { useQuery: () => networthQuery } },
    // Reached via useEffectiveSalaryProfileId → useActiveSalaryProfile, and
    // useEffectiveContribProfileId → useActiveContribProfile. An empty list
    // is the "nothing to resolve" case: the hook leaves the active id alone
    // rather than re-pointing it.
    salaryProfile: { list: { useQuery: () => ({ data: [] }) } },
    contributionProfile: { list: { useQuery: () => ({ data: [] }) } },
  },
}));

import { FinancialCheckupCard } from "@/components/cards/dashboard/financial-checkup-card";

const loading = { data: undefined, isLoading: true, error: null };
const withData = (data: unknown) => ({ data, isLoading: false, error: null });

const baseSavings = {
  efund: { monthsCovered: 4.5, monthsCoveredWithRepay: null },
};
const baseContribs = {
  people: [
    {
      accountTypes: [{ employerMatch: 3000 }],
      result: {},
      totalCompensation: 150000,
      salary: 150000,
      totals: {
        views: {
          projected: {
            savingsRateWithMatch: 0.3,
            savingsRateWithoutMatch: 0.25,
          },
        },
      },
    },
  ],
};
const baseMortgage = {
  result: {
    loans: [{ remainingMonths: 120, monthsAheadOfSchedule: 6 }],
  },
};
const baseNetworth = {
  result: { aawScoreMarket: 1.5, fiProgress: 0.5, fiTarget: 1000000 },
};

describe("FinancialCheckupCard smoke", () => {
  it("renders a loading card while any query is pending", () => {
    savingsQuery = loading;
    contribsQuery = loading;
    mortgageQuery = loading;
    networthQuery = loading;
    render(<FinancialCheckupCard />);
    expect(screen.getByText("Financial Checkup")).toBeInTheDocument();
  });

  it("renders an error card when any query errors", () => {
    savingsQuery = { data: undefined, isLoading: false, error: new Error("x") };
    contribsQuery = withData(baseContribs);
    mortgageQuery = withData(baseMortgage);
    networthQuery = withData(baseNetworth);
    render(<FinancialCheckupCard />);
    expect(screen.getByText("Failed to load")).toBeInTheDocument();
  });

  it("renders green Emergency Fund status when months covered >= 3", () => {
    savingsQuery = withData(baseSavings);
    contribsQuery = withData(baseContribs);
    mortgageQuery = withData(baseMortgage);
    networthQuery = withData(baseNetworth);
    render(<FinancialCheckupCard />);
    expect(screen.getByText("Emergency Fund")).toBeInTheDocument();
    expect(screen.getByText("4.5 mo covered")).toBeInTheDocument();
  });

  it("shows Employer Match captured amount when match exists", () => {
    savingsQuery = withData(baseSavings);
    contribsQuery = withData(baseContribs);
    mortgageQuery = withData(baseMortgage);
    networthQuery = withData(baseNetworth);
    render(<FinancialCheckupCard />);
    expect(screen.getByText("Employer Match")).toBeInTheDocument();
    expect(screen.getByText("$3,000.00/yr captured")).toBeInTheDocument();
  });

  it("shows 'Mortgage paid off' Debt Payoff status when no active loans remain", () => {
    savingsQuery = withData(baseSavings);
    contribsQuery = withData(baseContribs);
    mortgageQuery = withData({ result: { loans: [] } });
    networthQuery = withData(baseNetworth);
    render(<FinancialCheckupCard />);
    expect(screen.getByText("Mortgage paid off")).toBeInTheDocument();
  });

  it("shows 'Run retirement projection' FI status when fiCache is null and target unset", () => {
    savingsQuery = withData(baseSavings);
    contribsQuery = withData(baseContribs);
    mortgageQuery = withData(baseMortgage);
    networthQuery = withData({
      result: { aawScoreMarket: 1.5, fiProgress: 0, fiTarget: 1500000 },
    });
    render(<FinancialCheckupCard />);
    expect(screen.getByText("FI Progress")).toBeInTheDocument();
    expect(screen.getByText("Run retirement projection")).toBeInTheDocument();
  });

  it("shows an on-track green/total count subtitle summarizing steps", () => {
    savingsQuery = withData(baseSavings);
    contribsQuery = withData(baseContribs);
    mortgageQuery = withData(baseMortgage);
    networthQuery = withData(baseNetworth);
    render(<FinancialCheckupCard />);
    expect(screen.getByText(/\/\d+ on track/)).toBeInTheDocument();
  });
});
