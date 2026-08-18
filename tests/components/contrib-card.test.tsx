import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContribCard } from "@/components/paycheck/contrib-card";
import type { RawContrib } from "@/components/paycheck/types";

vi.mock("@/lib/trpc", () => ({
  trpc: {
    settings: {
      performanceAccounts: {
        list: { useQuery: () => ({ data: undefined }) },
      },
    },
  },
}));

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

vi.mock("@/components/ui/toggle", () => ({
  Toggle: ({
    isChecked,
    onChange,
    label,
  }: {
    isChecked: boolean;
    onChange: (v: boolean) => void;
    label: string;
  }) => (
    <button
      role="switch"
      aria-checked={isChecked}
      onClick={() => onChange(!isChecked)}
    >
      {label}
    </button>
  ),
}));

vi.mock("@/lib/utils/format", () => ({
  formatCurrency: (n: number) => `$${Math.round(n).toLocaleString()}`,
  formatPercent: (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`,
  accountDisplayName: (a: { accountType: string }) => a.accountType,
}));

vi.mock("@/components/ui/confirm-dialog", () => ({
  confirm: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/components/paycheck/inline-account-type", () => ({
  InlineAccountType: ({ value }: { value: string }) => <span>{value}</span>,
}));

vi.mock("@/lib/config/account-types", () => ({
  categoriesWithIrsLimit: () => ["401k"],
  getLimitGroup: () => "401k",
  isOverflowTarget: () => false,
  getDisplayConfig: () => ({ displayLabel: "401k", hasDiscountBar: false }),
  getAccountTypeConfig: () => ({ matchCountsTowardLimit: false }),
}));

vi.mock("@/lib/config/display-labels", () => ({
  TAX_TREATMENT_LABELS: { pre_tax: "Pre-Tax", tax_free: "Tax-Free" },
}));

const baseContrib: RawContrib = {
  id: 1,
  jobId: 10,
  personId: 1,
  accountType: "401k",
  subType: null,
  label: null,
  parentCategory: "Retirement",
  taxTreatment: "pre_tax",
  contributionMethod: "percent_of_salary",
  contributionValue: "5",
  employerMatchType: "none",
  employerMatchValue: null,
  employerMaxMatchPct: null,
  employerMatchTaxTreatment: "pre_tax",
  hsaCoverageType: null,
  ownership: "individual",
  autoMaximize: false,
  isActive: true,
  targetAnnual: null,
  allocationPriority: 0,
  notes: null,
  performanceAccountId: null,
};

const defaultProps = {
  contrib: baseContrib,
  onUpdateContrib: vi.fn(),
  onToggleAutoMax: vi.fn(),
  onDeleteContrib: vi.fn(),
  _methodLabel: (m: string) => m,
  salary: 100000,
  periodsPerYear: 26,
  annualLimit: 23000,
  siblingAnnualContribs: 0,
  employerMatchAnnual: 0,
};

describe("ContribCard", () => {
  it("renders account type and tax treatment", () => {
    render(<ContribCard {...defaultProps} />);
    expect(screen.getByText("401k")).toBeInTheDocument();
    expect(screen.getByText("Pre-Tax")).toBeInTheDocument();
  });

  it("shows the joint label when ownership is joint", () => {
    render(
      <ContribCard
        {...defaultProps}
        contrib={{ ...baseContrib, ownership: "joint" }}
      />,
    );
    expect(screen.getByText("(Joint)")).toBeInTheDocument();
  });

  it("shows Auto-max toggle for IRS-limited categories", () => {
    render(<ContribCard {...defaultProps} />);
    expect(screen.getByText("Auto-max")).toBeInTheDocument();
  });

  it("computes an auto-max preview for percent_of_salary contributions with remaining room", () => {
    // salary=100000, current 5% => $5,000/yr, remainingLimit = 23000 (no
    // siblings/match), targetPct = floor(23000/100000*100) = 23%
    render(<ContribCard {...defaultProps} />);
    expect(screen.getByText(/→ 23% of salary/)).toBeInTheDocument();
  });

  it("fires onToggleAutoMax with the computed target contribution value when enabled", () => {
    const onToggleAutoMax = vi.fn();
    render(<ContribCard {...defaultProps} onToggleAutoMax={onToggleAutoMax} />);
    fireEvent.click(screen.getByRole("switch", { name: "Auto-max" }));
    // 23% target computed from remainingLimit(23000)/salary(100000)*100 floored
    expect(onToggleAutoMax).toHaveBeenCalledWith(1, true, 23);
  });

  it("shows 'Already at max' when auto-max target equals current value", () => {
    render(
      <ContribCard
        {...defaultProps}
        contrib={{ ...baseContrib, contributionValue: "23" }}
      />,
    );
    expect(
      screen.getByText("Already at max — no change needed"),
    ).toBeInTheDocument();
  });

  it("shows the enabled auto-max status message when autoMaximize is true", () => {
    render(
      <ContribCard
        {...defaultProps}
        contrib={{ ...baseContrib, autoMaximize: true }}
      />,
    );
    expect(screen.getByText(/Set to 5.0% of salary/)).toBeInTheDocument();
  });

  it("accounts for sibling contributions sharing the same IRS limit", () => {
    render(<ContribCard {...defaultProps} siblingAnnualContribs={20000} />);
    // remainingLimit = 23000 - 20000 = 3000; targetPct = floor(3000/100000*100) = 3%
    expect(screen.getByText(/→ 3% of salary/)).toBeInTheDocument();
  });

  it("calls onUpdateContrib when contribution value is changed via method dropdown", () => {
    const onUpdateContrib = vi.fn();
    render(<ContribCard {...defaultProps} onUpdateContrib={onUpdateContrib} />);
    fireEvent.change(screen.getByTitle("Change contribution method"), {
      target: { value: "fixed_annual" },
    });
    expect(onUpdateContrib).toHaveBeenCalledWith(
      1,
      "contributionMethod",
      "fixed_annual",
    );
  });

  it("calls onDeleteContrib after confirmation when delete button is clicked", async () => {
    const onDeleteContrib = vi.fn();
    render(<ContribCard {...defaultProps} onDeleteContrib={onDeleteContrib} />);
    fireEvent.click(screen.getByTitle("Delete contribution account"));
    await vi.waitFor(() => expect(onDeleteContrib).toHaveBeenCalledWith(1));
  });
});
