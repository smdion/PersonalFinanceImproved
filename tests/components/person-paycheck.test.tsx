import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PersonPaycheck } from "@/components/paycheck/person-paycheck";
import type { PaycheckResult } from "@/lib/calculators/types/calculators";

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
  title: "Software Engineer" as string | null,
  annualSalary: "120000",
  bonusPercent: "10",
  bonusMultiplier: "1",
  bonusOverride: null as string | null,
  bonusMonth: 3 as number | null,
  bonusDayOfMonth: 15 as number | null,
  include401kInBonus: false,
  includeBonusInContributions: true,
  payPeriod: "biweekly",
  payWeek: "A",
  personId: 1,
  w4FilingStatus: "married",
  w4Box2cChecked: false,
  startDate: "2020-01-01",
};

const basePaycheck: PaycheckResult = {
  gross: 4615.38,
  preTaxDeductions: [],
  federalTaxableGross: 4615.38,
  federalWithholding: 692.31,
  ficaSS: 286.15,
  ficaMedicare: 66.92,
  postTaxDeductions: [],
  netPay: 3200,
  bonusEstimate: {
    bonusGross: 12000,
    bonusNet: 9360,
    bonusFederalWithholding: 2640,
    bonusFica: 0,
  },
  bonusPeriod: null,
  extraPaycheckMonths: [],
  yearSchedule: [],
  periodsPerYear: 26,
  periodsElapsedYtd: 0,
  nextPayDate: "2026-01-09",
  payFrequencyLabel: "Biweekly",
  warnings: [],
};

const defaultProps = {
  person: { name: "Sean", id: 1 },
  job: baseJob,
  salary: 120000,
  futureSalaryChanges: [],
  paycheck: basePaycheck,
  mode: "projected" as const,
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
