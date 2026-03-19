import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock all dashboard card components to isolate the page test
vi.mock("@/components/cards/dashboard", () => ({
  HouseholdIncomeCard: () => (
    <div data-testid="household-income">HouseholdIncome</div>
  ),
  SavingsRateCard: () => <div data-testid="savings-rate">SavingsRate</div>,
  BudgetStatusCard: () => <div data-testid="budget-status">BudgetStatus</div>,
  SavingsGoalsCard: () => <div data-testid="savings-goals">SavingsGoals</div>,
  RetirementCard: () => <div data-testid="retirement">Retirement</div>,
  MortgageCard: () => <div data-testid="mortgage">Mortgage</div>,
  NetWorthCard: () => <div data-testid="net-worth">NetWorth</div>,
  ContributionsCard: () => <div data-testid="contributions">Contributions</div>,
  TaxesCard: () => <div data-testid="taxes">Taxes</div>,
  FinancialCheckupCard: () => (
    <div data-testid="financial-checkup">FinancialCheckup</div>
  ),
  FidelityMultiplierCard: () => (
    <div data-testid="fidelity-multiplier">FidelityMultiplier</div>
  ),
  DollarMultiplierCard: () => (
    <div data-testid="dollar-multiplier">DollarMultiplier</div>
  ),
  LivingCostsCard: () => <div data-testid="living-costs">LivingCosts</div>,
}));

vi.mock("@/components/cards/dashboard/utils", () => ({
  ErrorCard: ({ title, message }: { title: string; message: string }) => (
    <div data-testid="error-card">
      {title}: {message}
    </div>
  ),
}));

vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <div data-testid="page-header">
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  ),
}));

vi.mock("@/components/onboarding/onboarding-wizard", () => ({
  OnboardingWizard: () => <div data-testid="onboarding-wizard">Wizard</div>,
}));

// Mock tRPC
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      settings: { invalidate: vi.fn() },
    }),
    settings: {
      isOnboardingComplete: {
        useQuery: () => ({ data: { complete: true } }),
      },
    },
  },
}));

describe("DashboardPage", () => {
  it("renders without crashing", async () => {
    // Dynamic import after mocks are set up
    const { default: DashboardPage } = await import("@/app/(dashboard)/page");
    render(<DashboardPage />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  it("renders all dashboard cards", async () => {
    const { default: DashboardPage } = await import("@/app/(dashboard)/page");
    render(<DashboardPage />);

    expect(screen.getByTestId("net-worth")).toBeInTheDocument();
    expect(screen.getByTestId("household-income")).toBeInTheDocument();
    expect(screen.getByTestId("financial-checkup")).toBeInTheDocument();
    expect(screen.getByTestId("savings-goals")).toBeInTheDocument();
    expect(screen.getByTestId("retirement")).toBeInTheDocument();
    expect(screen.getByTestId("contributions")).toBeInTheDocument();
    expect(screen.getByTestId("mortgage")).toBeInTheDocument();
    expect(screen.getByTestId("savings-rate")).toBeInTheDocument();
    expect(screen.getByTestId("budget-status")).toBeInTheDocument();
    expect(screen.getByTestId("taxes")).toBeInTheDocument();
  });

  it("does not show onboarding wizard when complete", async () => {
    const { default: DashboardPage } = await import("@/app/(dashboard)/page");
    render(<DashboardPage />);
    expect(screen.queryByTestId("onboarding-wizard")).toBeNull();
  });
});
