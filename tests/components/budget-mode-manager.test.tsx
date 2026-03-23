import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BudgetModeManager } from "@/components/budget/budget-mode-manager";

vi.mock("@/components/ui/inline-edit", () => ({
  InlineEdit: ({
    value,
    onSave,
  }: {
    value: string;
    onSave: (v: string) => void;
  }) => (
    <span data-testid={`inline-edit-${value}`} onClick={() => onSave(value)}>
      {value}
    </span>
  ),
}));

vi.mock("@/components/ui/help-tip", () => ({
  HelpTip: () => null,
}));

vi.mock("@/components/ui/confirm-dialog", () => ({
  confirm: () => Promise.resolve(true),
}));

describe("BudgetModeManager", () => {
  const defaultProps = {
    cols: ["Standard", "Lean"],
    onRenameColumn: vi.fn(),
    onRemoveColumn: vi.fn(),
    onAddColumn: vi.fn(),
    addColumnPending: false,
  };

  it("renders all column labels", () => {
    render(<BudgetModeManager {...defaultProps} />);
    expect(screen.getByText("Standard")).toBeInTheDocument();
    expect(screen.getByText("Lean")).toBeInTheDocument();
  });

  it("renders Budget Modes heading", () => {
    render(<BudgetModeManager {...defaultProps} />);
    expect(screen.getByText("Budget Modes")).toBeInTheDocument();
  });

  it("shows remove button for each column when more than one", () => {
    render(<BudgetModeManager {...defaultProps} />);
    const removeButtons = screen.getAllByTitle("Remove mode");
    expect(removeButtons).toHaveLength(2);
  });

  it("hides remove button when only one column", () => {
    render(<BudgetModeManager {...defaultProps} cols={["Standard"]} />);
    expect(screen.queryByTitle("Remove mode")).toBeNull();
  });

  it("calls onAddColumn when Add button is clicked with valid input", () => {
    const onAddColumn = vi.fn();
    render(<BudgetModeManager {...defaultProps} onAddColumn={onAddColumn} />);

    const input = screen.getByPlaceholderText("New mode name...");
    fireEvent.change(input, { target: { value: "Emergency" } });
    fireEvent.click(screen.getByText("Add"));

    expect(onAddColumn).toHaveBeenCalledWith("Emergency");
  });

  it("clears input after adding a column", () => {
    render(<BudgetModeManager {...defaultProps} />);

    const input = screen.getByPlaceholderText(
      "New mode name...",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Emergency" } });
    fireEvent.click(screen.getByText("Add"));

    expect(input.value).toBe("");
  });

  it("does not call onAddColumn when input is empty", () => {
    const onAddColumn = vi.fn();
    render(<BudgetModeManager {...defaultProps} onAddColumn={onAddColumn} />);

    fireEvent.click(screen.getByText("Add"));
    expect(onAddColumn).not.toHaveBeenCalled();
  });

  it("calls onAddColumn on Enter key press", () => {
    const onAddColumn = vi.fn();
    render(<BudgetModeManager {...defaultProps} onAddColumn={onAddColumn} />);

    const input = screen.getByPlaceholderText("New mode name...");
    fireEvent.change(input, { target: { value: "Frugal" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAddColumn).toHaveBeenCalledWith("Frugal");
  });

  it("trims whitespace from new mode name", () => {
    const onAddColumn = vi.fn();
    render(<BudgetModeManager {...defaultProps} onAddColumn={onAddColumn} />);

    const input = screen.getByPlaceholderText("New mode name...");
    fireEvent.change(input, { target: { value: "  Padded  " } });
    fireEvent.click(screen.getByText("Add"));

    expect(onAddColumn).toHaveBeenCalledWith("Padded");
  });

  it("disables Add button when addColumnPending is true", () => {
    render(<BudgetModeManager {...defaultProps} addColumnPending={true} />);

    // Type something to make the button "almost" enabled
    const input = screen.getByPlaceholderText("New mode name...");
    fireEvent.change(input, { target: { value: "Test" } });

    const addButton = screen.getByText("Add");
    expect(addButton).toBeDisabled();
  });

  it("disables Add button when input is whitespace-only", () => {
    render(<BudgetModeManager {...defaultProps} />);

    const input = screen.getByPlaceholderText("New mode name...");
    fireEvent.change(input, { target: { value: "   " } });

    const addButton = screen.getByText("Add");
    expect(addButton).toBeDisabled();
  });

  it("renders contribution profile dropdowns when profiles provided", () => {
    const profiles = [
      { id: 1, name: "Default", isDefault: true },
      { id: 2, name: "High Saver", isDefault: false },
    ];
    render(
      <BudgetModeManager
        {...defaultProps}
        contributionProfiles={profiles}
        columnContributionProfileIds={[null, 2]}
        onUpdateContributionProfiles={vi.fn()}
      />,
    );

    // Should show dropdown with "High Saver" option
    expect(screen.getAllByText("Default")).toHaveLength(2); // one per column
    expect(screen.getAllByText("High Saver")).toHaveLength(2); // option in each dropdown
  });

  it("does not render profile dropdowns when no profiles", () => {
    render(<BudgetModeManager {...defaultProps} />);
    expect(
      screen.queryByTitle(
        "Contribution profile for this mode's income calculations",
      ),
    ).toBeNull();
  });

  it("calls onRemoveColumn after confirmation", async () => {
    const onRemoveColumn = vi.fn();
    render(
      <BudgetModeManager {...defaultProps} onRemoveColumn={onRemoveColumn} />,
    );

    const removeButtons = screen.getAllByTitle("Remove mode");
    fireEvent.click(removeButtons[0]!);

    // confirm is mocked to resolve true
    await vi.waitFor(() => {
      expect(onRemoveColumn).toHaveBeenCalledWith(0);
    });
  });
});
