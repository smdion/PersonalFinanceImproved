/** A run's engine warnings: one amber box, a line each; nothing when none. */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EngineWarnings } from "@/components/retirement-projection/engine-warnings";

describe("EngineWarnings", () => {
  it("shows each warning on its own line in one box", () => {
    render(<EngineWarnings warnings={["First note", "Second note"]} />);
    const first = screen.getByText("First note");
    expect(screen.getByText("Second note").parentElement).toBe(
      first.parentElement,
    );
    expect(first.parentElement!.className).toContain("bg-amber-50");
  });

  it("renders nothing when there are no warnings", () => {
    const { container } = render(<EngineWarnings warnings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
