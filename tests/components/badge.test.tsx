/**
 * Tests for the shared Badge primitive (status/label tags — distinct from
 * AccountBadge, which derives colors from account-types config).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "@/components/ui/badge";

describe("Badge", () => {
  it("renders children", () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("gives every color its own styling", () => {
    const colors = [
      undefined,
      "blue",
      "green",
      "red",
      "amber",
      "purple",
      "indigo",
    ] as const;
    const classes = colors.map((color) => {
      const { unmount } = render(<Badge color={color}>Label</Badge>);
      const cls = screen.getByText("Label").className;
      unmount();
      return cls;
    });
    expect(new Set(classes).size).toBe(colors.length);
  });

  it("merges a custom className with the color classes", () => {
    render(<Badge className="ml-2">Extra</Badge>);
    const el = screen.getByText("Extra");
    expect(el.className).toContain("ml-2");
    expect(el.className.split(" ").length).toBeGreaterThan(1);
  });

  it("renders as an inline span", () => {
    render(<Badge>Tag</Badge>);
    expect(screen.getByText("Tag").tagName).toBe("SPAN");
  });
});
