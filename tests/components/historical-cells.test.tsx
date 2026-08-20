import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EditableCell, EditableRateCell } from "@/components/historical/cells";

// First direct coverage for these two cells. Written alongside their
// migration onto useInlineNumberEdit (Phase 3 item 3d) — each previously
// hand-rolled its own local editing/editValue state + save/keydown
// boilerplate; this locks in double-click-to-edit, blur/Enter-to-commit,
// Escape-to-cancel, and the two fields' differing value transforms
// (EditableCell is a raw number, EditableRateCell displays/edits a
// percent but stores a 0-1 rate).

describe("EditableCell", () => {
  const baseProps = {
    field: "cost",
    year: 2024,
    isCurrent: false,
    isSaving: false,
    notes: {},
    onUpsertNote: vi.fn(),
  };

  it("double-click enters edit mode seeded with the current value", () => {
    render(<EditableCell value={100} onSave={vi.fn()} {...baseProps} />);
    fireEvent.doubleClick(screen.getByText("$100.00"));
    expect(screen.getByDisplayValue("100")).toBeInTheDocument();
  });

  it("commits a changed value on blur", () => {
    const onSave = vi.fn();
    render(<EditableCell value={100} onSave={onSave} {...baseProps} />);
    fireEvent.doubleClick(screen.getByText("$100.00"));
    const input = screen.getByDisplayValue("100");
    fireEvent.change(input, { target: { value: "150" } });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledWith(2024, { cost: 150 });
  });

  it("does not save when the value is unchanged", () => {
    const onSave = vi.fn();
    render(<EditableCell value={100} onSave={onSave} {...baseProps} />);
    fireEvent.doubleClick(screen.getByText("$100.00"));
    const input = screen.getByDisplayValue("100");
    fireEvent.blur(input);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not save homeImprovements — it's derived, read-only via this path", () => {
    const onSave = vi.fn();
    render(
      <EditableCell
        value={100}
        onSave={onSave}
        {...baseProps}
        field="homeImprovements"
      />,
    );
    fireEvent.doubleClick(screen.getByText("$100.00"));
    const input = screen.getByDisplayValue("100");
    fireEvent.change(input, { target: { value: "200" } });
    fireEvent.blur(input);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Escape cancels without committing", () => {
    const onSave = vi.fn();
    render(<EditableCell value={100} onSave={onSave} {...baseProps} />);
    fireEvent.doubleClick(screen.getByText("$100.00"));
    const input = screen.getByDisplayValue("100");
    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("$100.00")).toBeInTheDocument();
  });

  it("does not enter edit mode when isCurrent is true", () => {
    render(
      <EditableCell
        value={100}
        onSave={vi.fn()}
        {...baseProps}
        isCurrent={true}
      />,
    );
    fireEvent.doubleClick(screen.getByText("$100.00"));
    expect(screen.queryByDisplayValue("100")).not.toBeInTheDocument();
  });
});

describe("EditableRateCell", () => {
  const baseProps = {
    field: "rateOfReturn",
    year: 2024,
    isCurrent: false,
    isSaving: false,
    notes: {},
    onUpsertNote: vi.fn(),
  };

  it("displays and edits as a percent, storing a 0-1 rate", () => {
    const onSave = vi.fn();
    render(<EditableRateCell value={0.07} onSave={onSave} {...baseProps} />);
    fireEvent.doubleClick(screen.getByText("7.0%"));
    const input = screen.getByDisplayValue("7.0");
    fireEvent.change(input, { target: { value: "8.5" } });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledWith(2024, { rateOfReturn: 0.085 });
  });

  it("Escape cancels without committing", () => {
    const onSave = vi.fn();
    render(<EditableRateCell value={0.07} onSave={onSave} {...baseProps} />);
    fireEvent.doubleClick(screen.getByText("7.0%"));
    const input = screen.getByDisplayValue("7.0");
    fireEvent.change(input, { target: { value: "50" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("7.0%")).toBeInTheDocument();
  });
});
