/**
 * Tests for the shared Button primitive — variant/size class application,
 * disabled behavior, ref forwarding, and native prop passthrough (onClick,
 * type, etc).
 */
import { createRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("renders children and defaults to primary/md styling", () => {
    render(<Button>Save</Button>);
    const btn = screen.getByText("Save");
    expect(btn.className).toContain("bg-blue-600");
    expect(btn.className).toContain("text-sm");
  });

  it("applies secondary variant styling", () => {
    render(<Button variant="secondary">Cancel</Button>);
    expect(screen.getByText("Cancel").className).toContain(
      "bg-surface-elevated",
    );
  });

  it("applies ghost variant styling", () => {
    render(<Button variant="ghost">Dismiss</Button>);
    expect(screen.getByText("Dismiss").className).toContain("text-muted");
  });

  it("applies danger variant styling", () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByText("Delete").className).toContain("bg-red-600");
  });

  it("applies xs size styling", () => {
    render(<Button size="xs">Tiny</Button>);
    expect(screen.getByText("Tiny").className).toContain("text-xs");
  });

  it("renders an icon before the label", () => {
    render(<Button icon={<span data-testid="icon">*</span>}>Go</Button>);
    const btn = screen.getByText("Go").closest("button")!;
    expect(btn.querySelector('[data-testid="icon"]')).toBeInTheDocument();
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click me</Button>);
    fireEvent.click(screen.getByText("Click me"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not call onClick when disabled", () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Click me
      </Button>,
    );
    fireEvent.click(screen.getByText("Click me"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("applies the disabled attribute and styling", () => {
    render(<Button disabled>Click me</Button>);
    const btn = screen.getByText("Click me") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.className).toContain("disabled:opacity-50");
  });

  it("merges a custom className with the variant/size classes", () => {
    render(<Button className="my-extra-class">Custom</Button>);
    expect(screen.getByText("Custom").className).toContain("my-extra-class");
  });

  it("forwards the ref to the underlying button element", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Ref me</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current?.textContent).toBe("Ref me");
  });

  it("passes through native button props like type", () => {
    render(<Button type="submit">Submit</Button>);
    expect((screen.getByText("Submit") as HTMLButtonElement).type).toBe(
      "submit",
    );
  });
});
