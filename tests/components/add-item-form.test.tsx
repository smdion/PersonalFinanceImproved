import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AddItemForm } from "@/components/budget/add-item-form";

// Mock FormError to render error messages simply
vi.mock("@/components/ui/form-error", () => ({
  FormError: ({ message, error, prefix }: { message?: string | null; error?: { message: string } | null; prefix?: string }) => {
    const text = message ?? error?.message ?? null;
    if (!text) return null;
    const display = prefix ? `${prefix}: ${text}` : text;
    return <p role="alert">{display}</p>;
  },
}));

const defaultProps = {
  category: "Housing",
  onAdd: vi.fn(),
  onCancel: vi.fn(),
  isPending: false,
};

describe("AddItemForm", () => {
  it("renders the input and action buttons", () => {
    render(<AddItemForm {...defaultProps} />);
    expect(screen.getByPlaceholderText("Item name...")).toBeInTheDocument();
    expect(screen.getByText("Add")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("shows validation error when submitting empty name", () => {
    render(<AddItemForm {...defaultProps} />);
    fireEvent.click(screen.getByText("Add"));
    expect(screen.getByText("Item name is required")).toBeInTheDocument();
    expect(defaultProps.onAdd).not.toHaveBeenCalled();
  });

  it("does not call onAdd when name is only whitespace", () => {
    const onAdd = vi.fn();
    render(<AddItemForm {...defaultProps} onAdd={onAdd} />);
    fireEvent.change(screen.getByPlaceholderText("Item name..."), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByText("Add"));
    expect(screen.getByText("Item name is required")).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("calls onAdd with trimmed name, category, and isEssential flag", () => {
    const onAdd = vi.fn();
    render(<AddItemForm {...defaultProps} onAdd={onAdd} />);
    fireEvent.change(screen.getByPlaceholderText("Item name..."), {
      target: { value: "  Rent  " },
    });
    fireEvent.click(screen.getByText("Add"));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith("Housing", "Rent", true); // isEssential defaults to true
  });

  it("passes isEssential=false when checkbox is unchecked", () => {
    const onAdd = vi.fn();
    render(<AddItemForm {...defaultProps} onAdd={onAdd} />);
    fireEvent.change(screen.getByPlaceholderText("Item name..."), {
      target: { value: "Netflix" },
    });
    // Uncheck the Essential checkbox
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByText("Add"));
    expect(onAdd).toHaveBeenCalledWith("Housing", "Netflix", false);
  });

  it("submits on Enter key press", () => {
    const onAdd = vi.fn();
    render(<AddItemForm {...defaultProps} onAdd={onAdd} />);
    const input = screen.getByPlaceholderText("Item name...");
    fireEvent.change(input, { target: { value: "Utilities" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith("Housing", "Utilities", true);
  });

  it("calls onCancel on Escape key press", () => {
    const onCancel = vi.fn();
    render(<AddItemForm {...defaultProps} onCancel={onCancel} />);
    const input = screen.getByPlaceholderText("Item name...");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when Cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(<AddItemForm {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("clears validation error when user starts typing", () => {
    render(<AddItemForm {...defaultProps} />);
    fireEvent.click(screen.getByText("Add")); // trigger error
    expect(screen.getByText("Item name is required")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Item name..."), {
      target: { value: "R" },
    });
    expect(screen.queryByText("Item name is required")).toBeNull();
  });

  it("disables Add button when isPending", () => {
    render(<AddItemForm {...defaultProps} isPending={true} />);
    const addBtn = screen.getByText("Adding...");
    expect(addBtn).toBeDisabled();
  });

  it("shows 'Adding...' text when isPending", () => {
    render(<AddItemForm {...defaultProps} isPending={true} />);
    expect(screen.getByText("Adding...")).toBeInTheDocument();
    expect(screen.queryByText("Add")).toBeNull();
  });

  it("displays mutation error from parent", () => {
    render(
      <AddItemForm
        {...defaultProps}
        error={{ message: "Duplicate name" }}
      />,
    );
    expect(screen.getByText("Failed to add item: Duplicate name")).toBeInTheDocument();
  });

  it("renders as standalone block with category label", () => {
    render(<AddItemForm {...defaultProps} standalone={true} />);
    expect(screen.getByText("Housing")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("First item name...")).toBeInTheDocument();
  });

  it("renders as table row when not standalone", () => {
    const { container } = render(
      <table>
        <tbody>
          <AddItemForm {...defaultProps} standalone={false} />
        </tbody>
      </table>,
    );
    expect(container.querySelector("tr")).not.toBeNull();
    expect(container.querySelector("td")).not.toBeNull();
  });
});
