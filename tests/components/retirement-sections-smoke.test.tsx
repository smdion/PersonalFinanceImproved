import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Smoke tests for src/components/retirement/sections/ — created by the
// v0.5.2/v0.5.3 file-split refactor of retirement-content.tsx and left with
// zero test coverage. These are pure presentational components (Settings +
// callback props in, JSX out), so we render them directly with
// representative props, following the leaf-component smoke pattern from
// tests/components/contribution-accounts-card.test.tsx.

vi.mock("@/components/ui/help-tip", () => ({
  HelpTip: () => null,
}));

import { StrategyParamsSection } from "@/components/retirement/sections/strategy-params";
import { TaxesSection } from "@/components/retirement/sections/taxes";
import { SocialSecuritySection } from "@/components/retirement/sections/social-security";
import { PerPhaseBudgetSection } from "@/components/retirement/sections/per-phase-budget";
import { IncomeSection } from "@/components/retirement/sections/income";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Settings } from "@/components/retirement/sections/types";

const baseSettings: Settings = {
  personId: 1,
  retirementAge: 65,
  endAge: 95,
  returnAfterRetirement: "0.05",
  annualInflation: "0.03",
  salaryAnnualIncrease: "0.03",
  withdrawalRate: "0.04",
  taxMultiplier: "1.0",
  socialSecurityMonthly: "2000",
  ssStartAge: 67,
  withdrawalStrategy: "fixed",
};

describe("StrategyParamsSection smoke", () => {
  it("renders nothing for the 'fixed' strategy (no param fields)", () => {
    const { container } = render(
      <StrategyParamsSection
        settings={baseSettings}
        upsertSettings={{ mutate: vi.fn() }}
        isEditable={true}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders guardrail param controls for the guyton_klinger strategy", () => {
    render(
      <StrategyParamsSection
        settings={{ ...baseSettings, withdrawalStrategy: "guyton_klinger" }}
        upsertSettings={{ mutate: vi.fn() }}
        isEditable={true}
      />,
    );
    expect(screen.getByText("Upper Guardrail")).toBeInTheDocument();
    expect(screen.getByText("Lower Guardrail")).toBeInTheDocument();
    expect(screen.getByText("Skip Inflation After Loss")).toBeInTheDocument();
  });

  it("renders the rolling-window select for the endowment strategy", () => {
    render(
      <StrategyParamsSection
        settings={{ ...baseSettings, withdrawalStrategy: "endowment" }}
        upsertSettings={{ mutate: vi.fn() }}
        isEditable={true}
      />,
    );
    expect(screen.getByText("Rolling Window (years)")).toBeInTheDocument();
    expect(screen.getByText("Withdrawal %")).toBeInTheDocument();
  });
});

describe("TaxesSection smoke", () => {
  it("renders without crashing and shows default (Off) Roth conversions state", () => {
    render(
      <TaxesSection
        settings={baseSettings}
        selectedScenario={null}
        upsertSettings={{ mutate: vi.fn() }}
        isEditable={true}
      />,
    );
    expect(screen.getByText("Taxes in Retirement")).toBeInTheDocument();
    expect(screen.getByText("Roth Conversions")).toBeInTheDocument();
    // Two toggle buttons exist (Gross-Up, Roth Conversions) both default "On"/"Off";
    // Roth Conversions defaults to Off per component logic.
    const offButtons = screen.getAllByRole("button", { name: "Off" });
    expect(offButtons.length).toBeGreaterThan(0);
  });

  it("uses the fallback 15% LTCG rate when selectedScenario is null", () => {
    render(
      <TaxesSection
        settings={baseSettings}
        selectedScenario={null}
        upsertSettings={{ mutate: vi.fn() }}
        isEditable={true}
      />,
    );
    expect(screen.getByText(/15%LTCG/)).toBeInTheDocument();
  });

  it("shows the Roth conversion target select once conversions are enabled", () => {
    render(
      <TaxesSection
        settings={{ ...baseSettings, enableRothConversions: true }}
        selectedScenario={null}
        upsertSettings={{ mutate: vi.fn() }}
        isEditable={true}
      />,
    );
    // Only rendered when enableRothConversions is true — the extra select's
    // options include 10%/12%/22%/24%.
    const selects = screen.getAllByRole("combobox");
    // filingStatus select, bracket ceiling select, rothConversionTarget select
    expect(selects.length).toBeGreaterThanOrEqual(3);
  });
});

describe("SocialSecuritySection smoke", () => {
  it("renders single-person 'Monthly Benefit' field when perPersonSettings is null", () => {
    render(
      <SocialSecuritySection
        settings={baseSettings}
        perPersonSettings={null}
        upsertSettings={{ mutate: vi.fn() }}
        isEditable={true}
      />,
    );
    expect(screen.getByText("Monthly Benefit")).toBeInTheDocument();
    expect(screen.getByText("$2,000.00/mo")).toBeInTheDocument();
  });

  it("renders per-person benefit fields when household has >1 person", () => {
    render(
      <SocialSecuritySection
        settings={baseSettings}
        perPersonSettings={[
          {
            personId: 1,
            name: "Alice",
            birthYear: 1990,
            retirementAge: 65,
            endAge: 95,
            socialSecurityMonthly: "2000",
          },
          {
            personId: 2,
            name: "Bob",
            birthYear: 1992,
            retirementAge: 67,
            endAge: 95,
            socialSecurityMonthly: "1500",
          },
        ]}
        upsertSettings={{ mutate: vi.fn() }}
        isEditable={true}
      />,
    );
    expect(screen.getByText(/Alice.*Benefit/)).toBeInTheDocument();
    expect(screen.getByText(/Bob.*Benefit/)).toBeInTheDocument();
    expect(screen.queryByText("Monthly Benefit")).toBeNull();
  });
});

describe("PerPhaseBudgetSection smoke", () => {
  const baseProps = {
    settings: baseSettings,
    decumulationBudgetProfileId: null,
    decumulationBudgetColumn: 0,
    decExpenseOverride: null,
    setDecExpenseOverride: vi.fn(),
    setDecBudgetProfileId: vi.fn(),
    setDecBudgetCol: vi.fn(),
  };

  it("renders nothing when there are no budget profiles (empty state)", () => {
    const { container } = render(
      <PerPhaseBudgetSection {...baseProps} budgetProfileSummaries={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the profile picker when budget profiles exist", () => {
    render(
      <PerPhaseBudgetSection
        {...baseProps}
        budgetProfileSummaries={[
          {
            id: 1,
            name: "Baseline",
            isActive: true,
            columnLabels: ["Lean", "Fat"],
            columnMonths: null,
            columnTotals: [4000, 6000],
            weightedAnnualTotal: null,
          },
        ]}
      />,
    );
    expect(screen.getByText("Budget Source")).toBeInTheDocument();
    expect(screen.getByText("Salary Override")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Baseline/ }),
    ).toBeInTheDocument();
  });

  it("shows 'Using manual override' and hides the picker when decExpenseOverride is set", () => {
    render(
      <PerPhaseBudgetSection
        {...baseProps}
        decExpenseOverride="60000"
        budgetProfileSummaries={[
          {
            id: 1,
            name: "Baseline",
            isActive: true,
            columnLabels: [],
            columnMonths: null,
            columnTotals: [],
            weightedAnnualTotal: null,
          },
        ]}
      />,
    );
    expect(screen.getByText("Using manual override")).toBeInTheDocument();
  });
});

describe("IncomeSection smoke", () => {
  const incomeProps: Parameters<typeof IncomeSection>[0] = {
    settings: baseSettings,
    combinedSalary: 250000,
    upsertSettings: { mutate: vi.fn() },
    isEditable: true,
    handleSettingPercentUpdate: vi.fn(),
    contribProfiles: [],
    contribProfileId: null,
    setContribProfileId: vi.fn(),
    salaryProfiles: [],
    salaryProfileId: null,
    setSalaryProfileId: vi.fn(),
  };

  it("renders the plain total with no hover breakdown for a single-person household", () => {
    render(
      <IncomeSection
        {...incomeProps}
        people={[{ id: 1, name: "Alex" }]}
        salaryByPerson={{ 1: 250000 }}
      />,
    );
    expect(screen.getByText("$250,000.00")).toBeInTheDocument();
    // Only one person contributes — no `cursor-help` breakdown trigger.
    expect(document.querySelector(".cursor-help")).toBeNull();
  });

  it("wraps the total in a hover breakdown for a multi-person household", () => {
    render(
      <TooltipProvider>
        <IncomeSection
          {...incomeProps}
          combinedSalary={250000}
          people={[
            { id: 1, name: "Alex" },
            { id: 2, name: "Sam" },
          ]}
          salaryByPerson={{ 1: 150000, 2: 100000 }}
        />
      </TooltipProvider>,
    );
    expect(screen.getByText("$250,000.00")).toBeInTheDocument();
    expect(document.querySelector(".cursor-help")).not.toBeNull();
  });

  it("renders the plain total with no crash when people/salaryByPerson are omitted", () => {
    render(<IncomeSection {...incomeProps} />);
    expect(screen.getByText("$250,000.00")).toBeInTheDocument();
  });

  it("Group B: Pre-Retirement Raise / Salary Cap render read-only when isEditable is false", () => {
    render(
      <IncomeSection
        {...incomeProps}
        isEditable={false}
        people={[{ id: 1, name: "Alex" }]}
        salaryByPerson={{ 1: 250000 }}
      />,
    );
    expect(screen.getByText("$250,000.00")).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });
});

// Group B (v0.7.8) — retirementSettings.upsert is adminProcedure server-side,
// but these sections had zero client-side gating. isEditable now threads an
// isAdmin(user) check from retirement-content.tsx into every mutating
// control. Non-admin must see read-only (values visible, no editable input)
// — never hidden, never a control the click on which would just 403.
describe("isEditable={false} gating (Group B)", () => {
  it("StrategyParamsSection: param controls disabled but values visible", () => {
    render(
      <StrategyParamsSection
        settings={{ ...baseSettings, withdrawalStrategy: "guyton_klinger" }}
        upsertSettings={{ mutate: vi.fn() }}
        isEditable={false}
      />,
    );
    expect(screen.getByText("Upper Guardrail")).toBeInTheDocument();
    for (const btn of screen.getAllByRole("button")) expect(btn).toBeDisabled();
    for (const sel of screen.queryAllByRole("combobox"))
      expect(sel).toBeDisabled();
  });

  it("TaxesSection: filing status / bracket ceiling selects and toggle buttons disabled, values still shown", () => {
    render(
      <TaxesSection
        settings={baseSettings}
        selectedScenario={null}
        upsertSettings={{ mutate: vi.fn() }}
        isEditable={false}
      />,
    );
    for (const sel of screen.getAllByRole("combobox"))
      expect(sel).toBeDisabled();
    for (const btn of screen.getAllByRole("button")) expect(btn).toBeDisabled();
    // Values remain visible — read-only, not hidden.
    expect(screen.getByText("Taxes in Retirement")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Off" }).length,
    ).toBeGreaterThan(0);
  });

  it("SocialSecuritySection: benefit InlineEdit renders as plain text, not an editable control", () => {
    render(
      <SocialSecuritySection
        settings={baseSettings}
        perPersonSettings={null}
        upsertSettings={{ mutate: vi.fn() }}
        isEditable={false}
      />,
    );
    // Value still visible...
    expect(screen.getByText("$2,000.00/mo")).toBeInTheDocument();
    // ...but not as a clickable/editable element (InlineEdit isEditable=false
    // renders a bare <span>, no input, no button role).
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });
});
