import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AddCategoryForm } from "@/components/budget/add-category-form";

// Mock FormError
vi.mock("@/components/ui/form-error", () => ({
  FormError: ({ message }: { message?: string | null }) => {
    if (!message) return null;
    return <p role="alert">{message}</p>;
  },
}));

describe("AddCategoryForm", () => {
  it("initially shows only the '+ New Category' button", () => {
    const onCreateCategory = vi.fn();
    render(<AddCategoryForm onCreateCategory={onCreateCategory} />);
    expect(screen.getByText("+ New Category")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Category name...")).toBeNull();
  });

  it("reveals the form when '+ New Category' is clicked", () => {
    const onCreateCategory = vi.fn();
    render(<AddCategoryForm onCreateCategory={onCreateCategory} />);
    fireEvent.click(screen.getByText("+ New Category"));
    expect(screen.getByPlaceholderText("Category name...")).toBeInTheDocument();
    expect(screen.getByText("Create")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("shows validation error when submitting empty name", () => {
    const onCreateCategory = vi.fn();
    render(<AddCategoryForm onCreateCategory={onCreateCategory} />);
    fireEvent.click(screen.getByText("+ New Category"));
    fireEvent.click(screen.getByText("Create"));
    expect(screen.getByText("Category name is required")).toBeInTheDocument();
    expect(onCreateCategory).not.toHaveBeenCalled();
  });

  it("shows validation error for whitespace-only name", () => {
    const onCreateCategory = vi.fn();
    render(<AddCategoryForm onCreateCategory={onCreateCategory} />);
    fireEvent.click(screen.getByText("+ New Category"));
    fireEvent.change(screen.getByPlaceholderText("Category name..."), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByText("Create"));
    expect(screen.getByText("Category name is required")).toBeInTheDocument();
    expect(onCreateCategory).not.toHaveBeenCalled();
  });

  it("calls onCreateCategory with trimmed name on valid submit", () => {
    const onCreateCategory = vi.fn();
    render(<AddCategoryForm onCreateCategory={onCreateCategory} />);
    fireEvent.click(screen.getByText("+ New Category"));
    fireEvent.change(screen.getByPlaceholderText("Category name..."), {
      target: { value: "  Utilities  " },
    });
    fireEvent.click(screen.getByText("Create"));
    expect(onCreateCategory).toHaveBeenCalledTimes(1);
    expect(onCreateCategory).toHaveBeenCalledWith("Utilities");
  });

  it("hides form and resets after successful submit", () => {
    const onCreateCategory = vi.fn();
    render(<AddCategoryForm onCreateCategory={onCreateCategory} />);
    fireEvent.click(screen.getByText("+ New Category"));
    fireEvent.change(screen.getByPlaceholderText("Category name..."), {
      target: { value: "Food" },
    });
    fireEvent.click(screen.getByText("Create"));

    // Form should collapse back to the button
    expect(screen.getByText("+ New Category")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Category name...")).toBeNull();
  });

  it("submits on Enter key", () => {
    const onCreateCategory = vi.fn();
    render(<AddCategoryForm onCreateCategory={onCreateCategory} />);
    fireEvent.click(screen.getByText("+ New Category"));
    const input = screen.getByPlaceholderText("Category name...");
    fireEvent.change(input, { target: { value: "Transport" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCreateCategory).toHaveBeenCalledWith("Transport");
  });

  it("cancels on Escape key and resets state", () => {
    const onCreateCategory = vi.fn();
    render(<AddCategoryForm onCreateCategory={onCreateCategory} />);
    fireEvent.click(screen.getByText("+ New Category"));
    const input = screen.getByPlaceholderText("Category name...");
    fireEvent.change(input, { target: { value: "Temp" } });
    fireEvent.keyDown(input, { key: "Escape" });

    // Form should be hidden
    expect(screen.getByText("+ New Category")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Category name...")).toBeNull();
  });

  it("cancels via Cancel button and resets state", () => {
    const onCreateCategory = vi.fn();
    render(<AddCategoryForm onCreateCategory={onCreateCategory} />);
    fireEvent.click(screen.getByText("+ New Category"));
    fireEvent.change(screen.getByPlaceholderText("Category name..."), {
      target: { value: "Temp" },
    });
    fireEvent.click(screen.getByText("Cancel"));

    expect(screen.getByText("+ New Category")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Category name...")).toBeNull();
  });

  it("clears validation error when user types", () => {
    const onCreateCategory = vi.fn();
    render(<AddCategoryForm onCreateCategory={onCreateCategory} />);
    fireEvent.click(screen.getByText("+ New Category"));
    fireEvent.click(screen.getByText("Create")); // trigger error
    expect(screen.getByText("Category name is required")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Category name..."), {
      target: { value: "A" },
    });
    expect(screen.queryByText("Category name is required")).toBeNull();
  });
});
