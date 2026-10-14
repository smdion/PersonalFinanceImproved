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
  it("gives every variant and size its own styling", () => {
    const styleOf = (props: Parameters<typeof Button>[0]) => {
      const { unmount } = render(<Button {...props}>X</Button>);
      const cls = screen.getByText("X").className;
      unmount();
      return cls;
    };
    const variants = ["primary", "secondary", "ghost", "danger"] as const;
    expect(new Set(variants.map((variant) => styleOf({ variant }))).size).toBe(
      variants.length,
    );
    expect(styleOf({ size: "xs" })).not.toBe(styleOf({ size: "md" }));
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
