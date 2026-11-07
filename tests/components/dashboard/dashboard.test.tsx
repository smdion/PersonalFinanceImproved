import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { resetTrpcMock, setQuery } from "../trpc-mock";

// Mock all dashboard card components to isolate the page test
vi.mock("@/components/dashboard/household-income-card", () => ({
  HouseholdIncomeCard: () => (
    <div data-testid="household-income">HouseholdIncome</div>
  ),
}));
vi.mock("@/components/dashboard/savings-goals-card", () => ({
  SavingsGoalsCard: () => <div data-testid="savings-goals">SavingsGoals</div>,
}));
vi.mock("@/components/dashboard/retirement-card", () => ({
  RetirementCard: () => <div data-testid="retirement">Retirement</div>,
}));
vi.mock("@/components/dashboard/net-worth-card", () => ({
  NetWorthCard: () => <div data-testid="net-worth">NetWorth</div>,
}));
vi.mock("@/components/dashboard/linked-balance-card", () => ({
  LinkedBalanceCard: () => (
    <div data-testid="linked-balance">LinkedBalance</div>
  ),
}));
vi.mock("@/components/dashboard/contributions-card", () => ({
  ContributionsCard: () => <div data-testid="contributions">Contributions</div>,
}));
vi.mock("@/components/dashboard/financial-checkup-card", () => ({
  FinancialCheckupCard: () => (
    <div data-testid="financial-checkup">FinancialCheckup</div>
  ),
}));
vi.mock("@/components/dashboard/living-costs-card", () => ({
  LivingCostsCard: () => <div data-testid="living-costs">LivingCosts</div>,
}));

vi.mock("@/components/dashboard/utils", () => ({
  ErrorCard: ({ title, message }: { title: string; message: string }) => (
    <div data-testid="error-card">
      {title}: {message}
    </div>
  ),
  CardBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
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
vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("../trpc-mock")).trpc,
}));

describe("DashboardPage", () => {
  beforeEach(() => {
    resetTrpcMock();
    setQuery("settings.isOnboardingComplete", { complete: true });
  });

  it("renders all dashboard cards", async () => {
    const { default: DashboardPage } =
      await import("@/app/(dashboard)/dashboard-content").then((m) => ({
        default: m.DashboardContent,
      }));
    render(<DashboardPage />);

    expect(screen.getByTestId("net-worth")).toBeInTheDocument();
    expect(screen.getByTestId("linked-balance")).toBeInTheDocument();
    expect(screen.getByTestId("household-income")).toBeInTheDocument();
    expect(screen.getByTestId("financial-checkup")).toBeInTheDocument();
    expect(screen.getByTestId("savings-goals")).toBeInTheDocument();
    expect(screen.getByTestId("retirement")).toBeInTheDocument();
    expect(screen.getByTestId("contributions")).toBeInTheDocument();
    expect(screen.getByTestId("living-costs")).toBeInTheDocument();
  });

  it("does not show onboarding wizard when complete", async () => {
    const { default: DashboardPage } =
      await import("@/app/(dashboard)/dashboard-content").then((m) => ({
        default: m.DashboardContent,
      }));
    render(<DashboardPage />);
    expect(screen.queryByTestId("onboarding-wizard")).toBeNull();
  });
});
