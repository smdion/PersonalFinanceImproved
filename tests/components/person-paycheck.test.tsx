import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PersonPaycheck } from "@/components/paycheck/person-paycheck";

vi.mock("@/components/ui/inline-edit", () => ({
  InlineEdit: ({
    value,
    formatDisplay,
  }: {
    value: string;
    formatDisplay?: (v: string) => string;
  }) => (
    <span data-testid="inline-edit">
      {formatDisplay ? formatDisplay(value) : value}
    </span>
  ),
}));

vi.mock("@/lib/utils/format", () => ({
  formatCurrency: (n: number) => `$${Math.round(n).toLocaleString()}`,
}));

vi.mock("@/lib/context/scenario-context", () => ({
  useScenario: () => ({ isInScenario: false }),
}));

vi.mock("@/components/paycheck/pay-stub", () => ({
  PayStub: () => <div data-testid="pay-stub">PayStub</div>,
}));

vi.mock("@/components/paycheck/annual-summary", () => ({
  AnnualSummary: () => <div data-testid="annual-summary">AnnualSummary</div>,
}));

vi.mock("@/components/paycheck/bonus-section", () => ({
  BonusSection: () => <div data-testid="bonus-section">BonusSection</div>,
}));

vi.mock("@/components/paycheck/contributions-section", () => ({
  ContributionsSection: () => (
    <div data-testid="contributions-section">ContributionsSection</div>
  ),
}));

vi.mock("@/components/paycheck/add-deduction-form", () => ({
  AddDeductionForm: () => (
    <div data-testid="add-deduction-form">AddDeductionForm</div>
  ),
}));

vi.mock("@/components/paycheck/ss-cap-indicator", () => ({
  SSCapIndicator: () => null,
}));

vi.mock("@/components/paycheck/pay-schedule-info", () => ({
  PayScheduleInfo: () => <div data-testid="pay-schedule">PaySchedule</div>,
}));

vi.mock("@/components/paycheck/salary-tracker", () => ({
  SalaryTracker: () => <div data-testid="salary-tracker">SalaryTracker</div>,
}));

const baseJob = {
  id: 1,
  employerName: "Acme Corp",
  title: "Software Engineer",
  annualSalary: "120000",
  bonusPercent: "10",
  bonusMultiplier: "1",
  bonusOverride: null,
  bonusMonth: 3,
  bonusDayOfMonth: 15,
  include401kInBonus: false,
  includeBonusInContributions: true,
  payPeriod: "biweekly",
  payWeek: "A",
  personId: 1,
  w4FilingStatus: "married",
  w4Box2cChecked: false,
  startDate: "2020-01-01",
};

const basePaycheck = {
  grossPerPeriod: 4615.38,
  netPerPeriod: 3200,
  annualGross: 120000,
  annualNet: 83200,
  annualFederalTax: 18000,
  annualStateTax: 6000,
  annualSocialSecurity: 7440,
  annualMedicare: 1740,
  annualPreTaxDeductions: 0,
  annualPostTaxDeductions: 0,
  annualContributions: 0,
  annualEmployerMatch: 0,
  periodsPerYear: 26,
  deductions: [],
  contributions: [],
  warnings: [],
};

const defaultProps = {
  person: { name: "Sean", id: 1 },
  job: baseJob,
  salary: 120000,
  futureSalaryChanges: [],
  paycheck: basePaycheck,
  mode: "standard" as const,
  activeSalaryOverride: null,
  onToggleSalary: vi.fn(),
  onUpdateJob: vi.fn(),
  rawDeductions: [],
  rawContribs: [],
  onUpdateDeduction: vi.fn(),
  onUpdateContrib: vi.fn(),
  contribExpanded: true,
  onToggleContrib: vi.fn(),
};

describe("PersonPaycheck", () => {
  it("renders person name", () => {
    render(<PersonPaycheck {...defaultProps} />);
    expect(screen.getByText("Sean")).toBeInTheDocument();
  });

  it("renders employer and title", () => {
    render(<PersonPaycheck {...defaultProps} />);
    expect(screen.getByText("Software Engineer")).toBeInTheDocument();
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
  });

  it("renders salary via InlineEdit", () => {
    render(<PersonPaycheck {...defaultProps} />);
    expect(screen.getByText("$120,000")).toBeInTheDocument();
  });

  it("renders pay stub component", () => {
    render(<PersonPaycheck {...defaultProps} />);
    expect(screen.getByTestId("pay-stub")).toBeInTheDocument();
  });

  it("renders annual summary component", () => {
    render(<PersonPaycheck {...defaultProps} />);
    expect(screen.getByTestId("annual-summary")).toBeInTheDocument();
  });

  it("renders contributions section", () => {
    render(<PersonPaycheck {...defaultProps} />);
    expect(screen.getByTestId("contributions-section")).toBeInTheDocument();
  });

  it("renders pay schedule info", () => {
    render(<PersonPaycheck {...defaultProps} />);
    expect(screen.getByTestId("pay-schedule")).toBeInTheDocument();
  });

  it("renders salary tracker", () => {
    render(<PersonPaycheck {...defaultProps} />);
    expect(screen.getByTestId("salary-tracker")).toBeInTheDocument();
  });

  it("renders without title when job.title is null", () => {
    render(
      <PersonPaycheck {...defaultProps} job={{ ...baseJob, title: null }} />,
    );
    expect(screen.queryByText("Software Engineer")).toBeNull();
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
  });
});
