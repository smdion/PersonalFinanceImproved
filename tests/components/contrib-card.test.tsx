import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContributionCard } from "@/components/contributions/contrib-card";
import type { RawContrib } from "@/components/paycheck/types";

// No query is registered: performanceAccounts.list has no data.
vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
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
    disabled,
  }: {
    isChecked: boolean;
    onChange: (v: boolean) => void;
    label: string;
    disabled?: boolean;
  }) => (
    <button
      role="switch"
      aria-checked={isChecked}
      disabled={disabled}
      onClick={() => onChange(!isChecked)}
    >
      {label}
    </button>
  ),
}));

vi.mock("@/components/ui/confirm-dialog", () => ({
  confirm: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/components/contributions/inline-account-type", () => ({
  InlineAccountType: ({ value }: { value: string }) => <span>{value}</span>,
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
  onUpdateContribution: vi.fn(),
  onToggleAutoMax: vi.fn(),
  onDeleteContribution: vi.fn(),
  _methodLabel: (m: string) => m,
  salary: 100000,
  periodsPerYear: 26,
  annualLimit: 23000,
  siblingAnnualContributions: 0,
  employerMatchAnnual: 0,
};

describe("ContribCard", () => {
  it("renders account type and tax treatment", () => {
    render(<ContributionCard {...defaultProps} />);
    expect(screen.getByText("401k")).toBeInTheDocument();
    expect(screen.getByText("Traditional")).toBeInTheDocument();
  });

  it("shows the joint label when ownership is joint", () => {
    render(
      <ContributionCard
        {...defaultProps}
        contrib={{ ...baseContrib, ownership: "joint" }}
      />,
    );
    expect(screen.getByText("(Joint)")).toBeInTheDocument();
  });

  it("shows Auto-max toggle for IRS-limited categories", () => {
    render(<ContributionCard {...defaultProps} />);
    expect(screen.getByText("Auto-max")).toBeInTheDocument();
  });

  it("computes an auto-max preview for percent_of_salary contributions with remaining room", () => {
    // salary=100000, current 5% => $5,000/yr, remainingLimit = 23000 (no
    // siblings/match), targetPct = floor(23000/100000*100) = 23%
    render(<ContributionCard {...defaultProps} />);
    expect(screen.getByText(/→ 23% of salary/)).toBeInTheDocument();
  });

  it("fires onToggleAutoMax with the computed target contribution value when enabled", () => {
    const onToggleAutoMax = vi.fn();
    render(
      <ContributionCard {...defaultProps} onToggleAutoMax={onToggleAutoMax} />,
    );
    fireEvent.click(screen.getByRole("switch", { name: "Auto-max" }));
    // 23% target computed from remainingLimit(23000)/salary(100000)*100 floored
    expect(onToggleAutoMax).toHaveBeenCalledWith(1, true, 23);
  });

  it("shows 'Already at max' when auto-max target equals current value", () => {
    render(
      <ContributionCard
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
      <ContributionCard
        {...defaultProps}
        contrib={{ ...baseContrib, autoMaximize: true }}
      />,
    );
    expect(
      screen.getByText("Set to 5% of salary ($5,000/yr toward $23,000 limit)"),
    ).toBeInTheDocument();
  });

  it("names a per-paycheck amount per paycheck, in the preview and once auto-maxed", () => {
    const perPaycheck = {
      ...baseContrib,
      contributionMethod: "fixed_per_period",
      contributionValue: "500",
    };
    const { unmount } = render(
      <ContributionCard {...defaultProps} contrib={perPaycheck} />,
    );
    expect(screen.getByText(/→ \$884\.61\/paycheck$/)).toBeInTheDocument();
    expect(screen.getByText(/^\$500(\.00)?\/paycheck \(/)).toBeInTheDocument();
    unmount();
    render(
      <ContributionCard
        {...defaultProps}
        contrib={{ ...perPaycheck, autoMaximize: true }}
      />,
    );
    expect(
      screen.getByText(
        /^Set to \$500(\.00)?\/paycheck \(\$13,000\/yr toward \$23,000 limit\)$/,
      ),
    ).toBeInTheDocument();
  });

  it("accounts for sibling contributions sharing the same IRS limit", () => {
    render(
      <ContributionCard {...defaultProps} siblingAnnualContributions={20000} />,
    );
    // remainingLimit = 23000 - 20000 = 3000; targetPct = floor(3000/100000*100) = 3%
    expect(screen.getByText(/→ 3% of salary/)).toBeInTheDocument();
  });

  it("calls onUpdateContrib when contribution value is changed via method dropdown", () => {
    const onUpdateContrib = vi.fn();
    render(
      <ContributionCard
        {...defaultProps}
        onUpdateContribution={onUpdateContrib}
      />,
    );
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
    render(
      <ContributionCard
        {...defaultProps}
        onDeleteContribution={onDeleteContrib}
      />,
    );
    fireEvent.click(screen.getByTitle("Delete contribution account"));
    await vi.waitFor(() => expect(onDeleteContrib).toHaveBeenCalledWith(1));
  });

  describe("Also taken from bonus checks", () => {
    const toggle = () =>
      screen.queryByRole("switch", { name: "Also taken from bonus checks" });

    it("shows for a payroll account and saves fromBonus", () => {
      const onUpdateContrib = vi.fn();
      render(
        <ContributionCard
          {...defaultProps}
          contrib={{ ...baseContrib, fromBonus: true }}
          onUpdateContribution={onUpdateContrib}
        />,
      );
      expect(toggle()).toHaveAttribute("aria-checked", "true");
      fireEvent.click(toggle()!);
      expect(onUpdateContrib).toHaveBeenCalledWith(1, "fromBonus", "false");
    });

    it("isn't offered for an account not paid through payroll", () => {
      render(
        <ContributionCard
          {...defaultProps}
          contrib={{ ...baseContrib, jobId: null, isPayrollDeducted: null }}
        />,
      );
      expect(toggle()).toBeNull();
    });

    it("is read-only without permission to edit profiles", () => {
      render(<ContributionCard {...defaultProps} contributionValueReadOnly />);
      expect(toggle()).toBeDisabled();
    });
  });
});
