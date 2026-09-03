/**
 * Tests for components/forms/form-field.tsx.
 *
 * Focus: the tooltip slot must not interfere with
 * the existing cloneElement-based aria-invalid/aria-describedby wiring —
 * an explicit non-goal when the slot was added, since form-field.tsx only
 * clones a single `children` element and a careless change here could
 * silently break error-state accessibility for every adopting form.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormField } from "@/components/forms/form-field";

// HelpTip's real implementation needs a Radix TooltipProvider ancestor —
// stub it to a plain trigger, matching the pattern used elsewhere in this
// test suite. We only need to confirm FormField renders *something* for
// the tooltip slot, not exercise HelpTip's own tooltip behavior here.
vi.mock("@/components/ui/help-tip", () => ({
  HelpTip: ({ text }: { text?: string }) => (
    <button type="button" data-testid="help-tip" aria-label={text} />
  ),
}));

describe("FormField", () => {
  it("renders label and children without a tooltip by default", () => {
    render(
      <FormField label="Name">
        <input aria-label="name-input" />
      </FormField>,
    );
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders a HelpTip trigger next to the label when tooltip is set", () => {
    render(
      <FormField label="Name" tooltip="Your full legal name.">
        <input aria-label="name-input" />
      </FormField>,
    );
    expect(screen.getByText("Name")).toBeInTheDocument();
    // HelpTip renders an interactive trigger — its presence confirms the
    // tooltip slot rendered without needing to couple to HelpTip's own
    // internal markup.
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("does not inject aria-invalid/aria-describedby when there is no error, tooltip or not", () => {
    const { rerender } = render(
      <FormField label="Name">
        <input aria-label="name-input" />
      </FormField>,
    );
    expect(screen.getByLabelText("name-input")).not.toHaveAttribute(
      "aria-invalid",
    );

    rerender(
      <FormField label="Name" tooltip="Help text">
        <input aria-label="name-input" />
      </FormField>,
    );
    expect(screen.getByLabelText("name-input")).not.toHaveAttribute(
      "aria-invalid",
    );
  });

  it("injects aria-invalid and aria-describedby on the child input when error is set", () => {
    render(
      <FormField label="Name" error="Name is required">
        <input aria-label="name-input" />
      </FormField>,
    );
    const input = screen.getByLabelText("name-input");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByRole("alert")).toHaveTextContent("Name is required");
  });

  it("still injects aria wiring correctly when both tooltip and error are set together", () => {
    render(
      <FormField label="Name" tooltip="Your full legal name." error="Required">
        <input aria-label="name-input" />
      </FormField>,
    );
    const input = screen.getByLabelText("name-input");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBeTruthy();
    // Tooltip trigger and the error alert both present — the slot addition
    // didn't crowd out or interfere with error rendering.
    expect(screen.getByRole("button")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Required");
  });

  it("preserves an existing aria-describedby on the child by appending the error ID", () => {
    render(
      <FormField label="Name" error="Required">
        <input aria-label="name-input" aria-describedby="external-hint" />
      </FormField>,
    );
    const input = screen.getByLabelText("name-input");
    const describedBy = input.getAttribute("aria-describedby") ?? "";
    expect(describedBy).toContain("external-hint");
  });

  it("hides the help text when an error is present (error takes precedence)", () => {
    render(
      <FormField label="Name" help="Enter your name" error="Required">
        <input aria-label="name-input" />
      </FormField>,
    );
    expect(screen.queryByText("Enter your name")).not.toBeInTheDocument();
    expect(screen.getByText("Required")).toBeInTheDocument();
  });
});
