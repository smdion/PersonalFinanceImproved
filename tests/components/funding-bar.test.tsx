/**
 * The one FundingBar (Dashboard's Contributions card, Paycheck's
 * snapshot): the 100% line is drawn beside a lone bar only on request.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { FundingBar } from "@/components/paycheck/funding-bar";

const markers = (c: HTMLElement) =>
  c.querySelectorAll('[title="100% IRS annual limit"]').length;

describe("FundingBar", () => {
  it("draws no 100% line beside a lone bar by default (Paycheck)", () => {
    const { container } = render(<FundingBar pct={0.5} />);
    expect(markers(container)).toBe(0);
  });

  it("draws the 100% line with limitMarker (Dashboard)", () => {
    const { container } = render(<FundingBar pct={0.5} limitMarker />);
    expect(markers(container)).toBe(1);
    // The line is placed against the bar itself.
    expect(container.firstElementChild?.className).toBe(
      "bg-surface-strong relative h-2 w-full rounded-full",
    );
  });

  it("always draws it when the match is drawn beyond the limit", () => {
    const { container } = render(<FundingBar pct={0.5} matchPct={0.2} />);
    expect(markers(container)).toBe(1);
  });
});
