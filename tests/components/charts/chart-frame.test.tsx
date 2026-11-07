import { cloneElement, type ReactElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Line, LineChart } from "recharts";
import { ChartFrame } from "@/components/charts/chart-frame";

// happy-dom lays nothing out, so a responsive container measures 0 and
// Recharts draws no SVG; here it hands the chart a fixed size instead.
vi.mock("recharts", async (orig) => ({
  ...(await orig<typeof import("recharts")>()),
  ResponsiveContainer: ({
    children,
  }: {
    children: ReactElement<{ width?: number; height?: number }>;
  }) => cloneElement(children, { width: 400, height: 200 }),
}));

const summary = {
  label: "Savings over time",
  text: "Savings over time, 2024 to 2026. 2026: Savings $3,000.00.",
};

function Frame() {
  return (
    <ChartFrame summary={summary} height={200}>
      <LineChart data={[{ x: 1, y: 2 }]}>
        <Line dataKey="y" />
      </LineChart>
    </ChartFrame>
  );
}

describe("ChartFrame", () => {
  it("names the chart an image, described by its sr-only summary", () => {
    render(<Frame />);
    const chart = screen.getByRole("img", { name: "Savings over time" });
    expect(chart).toHaveAccessibleDescription(summary.text);
    const described = document.getElementById(
      chart.getAttribute("aria-describedby")!,
    );
    expect(described).toHaveClass("sr-only");
    expect(described).toHaveTextContent(summary.text);
  });

  it("keeps the chart a keyboard stop", () => {
    render(<Frame />);
    expect(screen.getByRole("img")).toHaveAttribute("tabindex", "0");
  });

  it("puts the summary before the chart, so the chart stays last child", () => {
    const { container } = render(<Frame />);
    expect(container.firstElementChild).toHaveClass("sr-only");
    expect(container.lastElementChild).not.toHaveClass("sr-only");
    expect(
      container.lastElementChild?.querySelector("svg[role='img']"),
    ).not.toBeNull();
  });
});
