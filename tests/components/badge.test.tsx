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

  it("defaults to the gray color scheme", () => {
    render(<Badge>Default</Badge>);
    expect(screen.getByText("Default").className).toContain(
      "bg-surface-strong",
    );
  });

  it.each([
    ["blue", "bg-blue-100"],
    ["green", "bg-green-100"],
    ["red", "bg-red-100"],
    ["amber", "bg-amber-100"],
    ["purple", "bg-purple-100"],
    ["indigo", "bg-indigo-100"],
  ] as const)("applies the %s color scheme", (color, expectedClass) => {
    render(<Badge color={color}>Label</Badge>);
    expect(screen.getByText("Label").className).toContain(expectedClass);
  });

  it("merges a custom className with the color classes", () => {
    render(<Badge className="ml-2">Extra</Badge>);
    const el = screen.getByText("Extra");
    expect(el.className).toContain("ml-2");
    expect(el.className).toContain("bg-surface-strong");
  });

  it("renders as an inline span", () => {
    render(<Badge>Tag</Badge>);
    expect(screen.getByText("Tag").tagName).toBe("SPAN");
  });
});
