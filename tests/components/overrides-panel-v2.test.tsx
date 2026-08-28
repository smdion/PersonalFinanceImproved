/**
 * Tests for OverridesPanelV2 — the step-by-step wizard for adding/editing
 * projection overrides (contribution rate, withdrawal rate, lump sums,
 * salary/budget changes, Roth conversion, routing, reset). This is one of
 * the most complex interaction surfaces in the app: a 3-step wizard whose
 * available options and behavior depend on whether the selected year is
 * pre- or post-retirement.
 *
 * Strategy: mirror the baseMockState pattern from projection-splits.test.tsx
 * — a loosely-typed mock of `ProjectionState` with only the fields
 * OverridesPanelV2 actually reads.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/components/ui/help-tip", () => ({
  HelpTip: ({ text }: { text?: string }) => (
    <span data-testid="help-tip" title={text} />
  ),
}));

import { OverridesPanelV2 } from "@/components/cards/projection/overrides-panel-v2";

const CURRENT_YEAR = new Date().getFullYear();
const RETIREMENT_AGE = 65;
const CURRENT_AGE = 40;
const RET_YEAR = CURRENT_YEAR + (RETIREMENT_AGE - CURRENT_AGE);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function baseMockState(overrides: Record<string, unknown> = {}): any {
  return {
    accumOverrides: [],
    setAccumOverrides: vi.fn(),
    decumOverrides: [],
    setDecumOverrides: vi.fn(),
    dbSalaryOverrides: [],
    dbBudgetOverrides: [],
    individualAccountNames: [
      { name: "401k - Alice", category: "401k" },
      { name: "Brokerage - Joint", category: "brokerage" },
    ],
    contribProfileSummaries: [],
    budgetProfileSummaries: [],
    salaryOverridePersonId: 1,
    createSalaryOverride: { mutate: vi.fn() },
    deleteSalaryOverride: { mutate: vi.fn() },
    createBudgetOverride: { mutate: vi.fn() },
    deleteBudgetOverride: { mutate: vi.fn() },
    engineSettings: {
      retirementAge: RETIREMENT_AGE,
      withdrawalStrategy: "fixed",
    },
    result: {
      projectionByYear: [{ age: CURRENT_AGE }],
    },
    ...overrides,
  };
}

/** Opens the wizard and advances past the Year step, leaving Type step showing. */
function openWizardToTypeStep(year?: string) {
  fireEvent.click(screen.getByText("+ Add Override"));
  if (year) {
    const yearInput = screen.getByLabelText(/Starting Year|Year/);
    fireEvent.change(yearInput, { target: { value: year } });
  }
  fireEvent.click(screen.getByText("Next"));
}

describe("OverridesPanelV2", () => {
  it("renders without crashing with no overrides", () => {
    render(<OverridesPanelV2 state={baseMockState()} />);
    expect(screen.getByText("Overrides")).toBeInTheDocument();
    expect(
      screen.getByText(
        "No overrides — projection uses page settings for all years",
      ),
    ).toBeInTheDocument();
  });

  it("shows the active override count when overrides exist", () => {
    const s = baseMockState({
      accumOverrides: [{ year: 2030, contributionRate: 0.2 }],
    });
    render(<OverridesPanelV2 state={s} />);
    expect(screen.getByText("1 active")).toBeInTheDocument();
  });

  it("renders a summary row for an existing accumulation override", () => {
    const s = baseMockState({
      accumOverrides: [{ year: 2030, contributionRate: 0.2, notes: "Raise" }],
    });
    render(<OverridesPanelV2 state={s} />);
    expect(screen.getByText("2030")).toBeInTheDocument();
    expect(screen.getByText("Contribution")).toBeInTheDocument();
    expect(screen.getByText(/Rate: 20.0%/)).toBeInTheDocument();
    expect(screen.getByText(/\(Raise\)/)).toBeInTheDocument();
  });

  it("deletes an accumulation override when the × button is clicked", () => {
    const setAccumOverrides = vi.fn();
    const s = baseMockState({
      accumOverrides: [{ year: 2030, contributionRate: 0.2 }],
      setAccumOverrides,
    });
    render(<OverridesPanelV2 state={s} />);
    fireEvent.click(screen.getByLabelText("Delete"));
    expect(setAccumOverrides).toHaveBeenCalledTimes(1);
    const updater = setAccumOverrides.mock.calls[0]![0];
    expect(updater([{ year: 2030, contributionRate: 0.2 }])).toEqual([]);
  });

  it("deletes a life-change (salary) override via the mutation", () => {
    const deleteSalaryOverride = { mutate: vi.fn() };
    const s = baseMockState({
      dbSalaryOverrides: [
        { id: 7, projectionYear: 2031, overrideSalary: 150000 },
      ],
      deleteSalaryOverride,
    });
    render(<OverridesPanelV2 state={s} />);
    fireEvent.click(screen.getByLabelText("Delete"));
    expect(deleteSalaryOverride.mutate).toHaveBeenCalledWith({ id: 7 });
  });

  it("opens the wizard on '+ Add Override' and shows the Year step", () => {
    render(<OverridesPanelV2 state={baseMockState()} />);
    fireEvent.click(screen.getByText("+ Add Override"));
    expect(screen.getByText("Cancel")).toBeInTheDocument();
    expect(screen.getByText("Starting Year")).toBeInTheDocument();
  });

  it("closes the wizard when Cancel is clicked", () => {
    render(<OverridesPanelV2 state={baseMockState()} />);
    fireEvent.click(screen.getByText("+ Add Override"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("Starting Year")).not.toBeInTheDocument();
    expect(screen.getByText("+ Add Override")).toBeInTheDocument();
  });

  it("advances from Year step to Type step showing pre-retirement options", () => {
    render(<OverridesPanelV2 state={baseMockState()} />);
    openWizardToTypeStep(String(RET_YEAR - 5));
    expect(screen.getByText(/pre-retirement/)).toBeInTheDocument();
    expect(screen.getByText(/Contribution Rate/)).toBeInTheDocument();
    expect(screen.queryByText(/Withdrawal Rate/)).not.toBeInTheDocument();
  });

  it("advances from Year step to Type step showing post-retirement options", () => {
    render(<OverridesPanelV2 state={baseMockState()} />);
    openWizardToTypeStep(String(RET_YEAR + 5));
    expect(screen.getByText(/post-retirement/)).toBeInTheDocument();
    expect(screen.getByText(/Budget Change/)).toBeInTheDocument();
    expect(screen.queryByText(/Contribution Rate/)).not.toBeInTheDocument();
  });

  it("does not offer Withdrawal Rate as a new-override type (R45 Step 3, Finding 2 — inert for every strategy)", () => {
    render(<OverridesPanelV2 state={baseMockState()} />);
    openWizardToTypeStep(String(RET_YEAR + 5));
    expect(screen.queryByText(/Withdrawal Rate/)).not.toBeInTheDocument();
  });

  it("always shows phase-agnostic options (Lump Sum, Account Routing, Reset)", () => {
    render(<OverridesPanelV2 state={baseMockState()} />);
    openWizardToTypeStep(String(RET_YEAR - 5));
    expect(screen.getByText(/Lump Sum/)).toBeInTheDocument();
    expect(screen.getByText(/Account Routing/)).toBeInTheDocument();
    expect(screen.getByText(/Reset to Defaults/)).toBeInTheDocument();
  });

  it("completes the contribution_rate flow and calls setAccumOverrides with the right shape", () => {
    const setAccumOverrides = vi.fn();
    const s = baseMockState({ setAccumOverrides });
    render(<OverridesPanelV2 state={s} />);
    openWizardToTypeStep(String(RET_YEAR - 5));
    fireEvent.click(screen.getByText(/Contribution Rate/));

    const rateInput = screen.getByPlaceholderText("15");
    fireEvent.change(rateInput, { target: { value: "20" } });
    fireEvent.click(screen.getByText("Save"));

    expect(setAccumOverrides).toHaveBeenCalledTimes(1);
    const updater = setAccumOverrides.mock.calls[0]![0];
    const result = updater([]);
    expect(result).toEqual([{ year: RET_YEAR - 5, contributionRate: 0.2 }]);
    // Wizard should close after save.
    expect(screen.queryByText("Save")).not.toBeInTheDocument();
  });

  it("does not submit the SimpleNumberForm when value is invalid", () => {
    const setAccumOverrides = vi.fn();
    const s = baseMockState({ setAccumOverrides });
    render(<OverridesPanelV2 state={s} />);
    openWizardToTypeStep(String(RET_YEAR - 5));
    fireEvent.click(screen.getByText(/Contribution Rate/));
    fireEvent.click(screen.getByText("Save"));
    expect(setAccumOverrides).not.toHaveBeenCalled();
  });

  // "withdrawal_rate" is no longer offered from the type picker (R45 Step 3,
  // Finding 2 — inert for every strategy, not just 4/8), but a household
  // with a pre-existing saved override of this type can still edit or
  // delete it, so that path stays covered via the edit flow instead of the
  // picker.
  it("edits a pre-existing withdrawal_rate override and calls setDecumOverrides", () => {
    const setDecumOverrides = vi.fn();
    const s = baseMockState({
      decumOverrides: [{ year: RET_YEAR + 5, withdrawalRate: 0.035 }],
      setDecumOverrides,
    });
    render(<OverridesPanelV2 state={s} />);
    fireEvent.click(screen.getByLabelText("Edit"));

    const rateInput = screen.getByPlaceholderText("3.5") as HTMLInputElement;
    expect(Number(rateInput.value)).toBeCloseTo(3.5);
    fireEvent.change(rateInput, { target: { value: "4" } });
    fireEvent.click(screen.getByText("Save"));

    expect(setDecumOverrides).toHaveBeenCalledTimes(1);
    const result = setDecumOverrides.mock.calls[0]![0]([]);
    expect(result).toEqual([{ year: RET_YEAR + 5, withdrawalRate: 0.04 }]);
  });

  it("shows the legacy/no-effect note when editing a pre-existing withdrawal_rate override", () => {
    const s = baseMockState({
      decumOverrides: [{ year: RET_YEAR + 5, withdrawalRate: 0.035 }],
      engineSettings: {
        retirementAge: RETIREMENT_AGE,
        withdrawalStrategy: "guyton_klinger",
      },
    });
    render(<OverridesPanelV2 state={s} />);
    fireEvent.click(screen.getByLabelText("Edit"));
    expect(screen.getByText(/doesn.t change your plan/)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("3.5").closest("label"),
    ).toHaveTextContent("legacy, has no effect");
  });

  it("completes the lump_sum flow for a pre-retirement year via setAccumOverrides", () => {
    const setAccumOverrides = vi.fn();
    const s = baseMockState({ setAccumOverrides });
    render(<OverridesPanelV2 state={s} />);
    openWizardToTypeStep(String(RET_YEAR - 5));
    fireEvent.click(screen.getByText(/Lump Sum/));

    fireEvent.change(screen.getByPlaceholderText("$50,000"), {
      target: { value: "10000" },
    });
    fireEvent.click(screen.getByText("Add"));

    expect(setAccumOverrides).toHaveBeenCalledTimes(1);
    const result = setAccumOverrides.mock.calls[0]![0]([]);
    expect(result).toHaveLength(1);
    expect(result[0].year).toBe(RET_YEAR - 5);
    expect(result[0].lumpSums[0].amount).toBe(10000);
  });

  it("completes the lump_sum flow for a post-retirement year via setDecumOverrides", () => {
    const setDecumOverrides = vi.fn();
    const s = baseMockState({ setDecumOverrides });
    render(<OverridesPanelV2 state={s} />);
    openWizardToTypeStep(String(RET_YEAR + 5));
    fireEvent.click(screen.getByText(/Lump Sum/));

    fireEvent.change(screen.getByPlaceholderText("$50,000"), {
      target: { value: "10000" },
    });
    fireEvent.click(screen.getByText("Add"));

    expect(setDecumOverrides).toHaveBeenCalledTimes(1);
    const result = setDecumOverrides.mock.calls[0]![0]([]);
    expect(result[0].year).toBe(RET_YEAR + 5);
  });

  it("completes the roth_conversion flow and calls setDecumOverrides", () => {
    const setDecumOverrides = vi.fn();
    const s = baseMockState({ setDecumOverrides });
    render(<OverridesPanelV2 state={s} />);
    openWizardToTypeStep(String(RET_YEAR + 5));
    fireEvent.click(screen.getByText(/Roth Conversion/));

    fireEvent.change(screen.getByPlaceholderText("22"), {
      target: { value: "24" },
    });
    fireEvent.click(screen.getByText("Save"));

    const result = setDecumOverrides.mock.calls[0]![0]([]);
    expect(result).toEqual([
      { year: RET_YEAR + 5, rothConversionTarget: 0.24 },
    ]);
  });

  it("completes the routing flow for a pre-retirement year (waterfall/percentage only)", () => {
    const setAccumOverrides = vi.fn();
    const s = baseMockState({ setAccumOverrides });
    render(<OverridesPanelV2 state={s} />);
    openWizardToTypeStep(String(RET_YEAR - 5));
    fireEvent.click(screen.getByText(/Account Routing/));

    // Pre-retirement routing has no bracket_filling option.
    expect(screen.queryByText(/Bracket Filling/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Save"));

    const result = setAccumOverrides.mock.calls[0]![0]([]);
    expect(result).toEqual([{ year: RET_YEAR - 5, routingMode: "waterfall" }]);
  });

  it("completes the reset flow for a pre-retirement year", () => {
    const setAccumOverrides = vi.fn();
    const s = baseMockState({ setAccumOverrides });
    render(<OverridesPanelV2 state={s} />);
    openWizardToTypeStep(String(RET_YEAR - 5));
    fireEvent.click(screen.getByText(/Reset to Defaults/));
    fireEvent.click(screen.getByText(`Reset from ${RET_YEAR - 5}`));

    const result = setAccumOverrides.mock.calls[0]![0]([]);
    expect(result).toEqual([{ year: RET_YEAR - 5, reset: true }]);
  });

  it("cancels out of the reset confirmation without submitting", () => {
    const setAccumOverrides = vi.fn();
    const s = baseMockState({ setAccumOverrides });
    render(<OverridesPanelV2 state={s} />);
    openWizardToTypeStep(String(RET_YEAR - 5));
    fireEvent.click(screen.getByText(/Reset to Defaults/));
    // Both the wizard header and the reset step have a "Cancel" button —
    // click the one inside the reset confirmation (last in document order).
    const cancelButtons = screen.getAllByText("Cancel");
    fireEvent.click(cancelButtons[cancelButtons.length - 1]!);
    expect(setAccumOverrides).not.toHaveBeenCalled();
    expect(screen.getByText("+ Add Override")).toBeInTheDocument();
  });

  it("completes the salary_change flow with a custom salary and calls createSalaryOverride", () => {
    const createSalaryOverride = { mutate: vi.fn() };
    const s = baseMockState({ createSalaryOverride });
    render(<OverridesPanelV2 state={s} />);
    openWizardToTypeStep(String(RET_YEAR - 5));
    fireEvent.click(screen.getByText(/Contribution \/ Salary/));

    fireEvent.change(screen.getByPlaceholderText("150000"), {
      target: { value: "175000" },
    });
    fireEvent.click(screen.getByText("Save"));

    expect(createSalaryOverride.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        personId: 1,
        projectionYear: RET_YEAR - 5,
        overrideSalary: "175000",
        contributionProfileId: null,
      }),
    );
  });

  it("completes the budget_change flow with a custom amount and calls createBudgetOverride", () => {
    const createBudgetOverride = { mutate: vi.fn() };
    const s = baseMockState({ createBudgetOverride });
    render(<OverridesPanelV2 state={s} />);
    openWizardToTypeStep(String(RET_YEAR + 5));
    fireEvent.click(screen.getByText(/Budget Change/));

    fireEvent.change(screen.getByPlaceholderText("90000"), {
      target: { value: "60000" },
    });
    fireEvent.click(screen.getByText("Save"));

    expect(createBudgetOverride.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        personId: 1,
        projectionYear: RET_YEAR + 5,
        overrideMonthlyBudget: "5000",
      }),
    );
  });

  it("opens the wizard pre-filled in edit mode when the edit icon is clicked", () => {
    const s = baseMockState({
      accumOverrides: [{ year: 2030, contributionRate: 0.15 }],
    });
    render(<OverridesPanelV2 state={s} />);
    fireEvent.click(screen.getByLabelText("Edit"));
    expect(screen.getByText("Editing override for 2030")).toBeInTheDocument();
    const rateInput = screen.getByPlaceholderText("15") as HTMLInputElement;
    expect(rateInput.value).toBe("15");
  });

  it("supports navigating back from the Type step to the Year step", () => {
    render(<OverridesPanelV2 state={baseMockState()} />);
    openWizardToTypeStep(String(RET_YEAR - 5));
    fireEvent.click(screen.getByText("← Back"));
    expect(screen.getByText("Starting Year")).toBeInTheDocument();
  });

  it("supports navigating back from the Fields step to the Type step", () => {
    render(<OverridesPanelV2 state={baseMockState()} />);
    openWizardToTypeStep(String(RET_YEAR - 5));
    fireEvent.click(screen.getByText(/Contribution Rate/));
    // Fields step shows "New Contribution Rate (%)" — confirm we left Type step.
    expect(screen.getByText("New Contribution Rate (%)")).toBeInTheDocument();

    fireEvent.click(screen.getByText("← Back"));
    // Back on the Type step: the option grid is visible again and the Fields
    // step content is gone.
    expect(screen.getByText(/Contribution Rate/)).toBeInTheDocument();
    expect(
      screen.queryByText("New Contribution Rate (%)"),
    ).not.toBeInTheDocument();
  });
});
