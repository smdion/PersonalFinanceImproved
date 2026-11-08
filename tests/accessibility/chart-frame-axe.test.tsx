/**
 * axe on ChartFrame with its chart drawn: the page mounts in axe.test.tsx
 * render charts at zero size (happy-dom lays nothing out), so they never
 * reach the chart's own SVG.
 */
import { cloneElement, type ReactElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import * as axe from "axe-core";
import { Bar, BarChart, Line, LineChart } from "recharts";
import { ChartFrame } from "@/components/charts/chart-frame";

vi.mock("recharts", async (orig) => ({
  ...(await orig<typeof import("recharts")>()),
  ResponsiveContainer: ({
    children,
  }: {
    children: ReactElement<{ width?: number; height?: number }>;
  }) => cloneElement(children, { width: 400, height: 200 }),
}));

const summary = { label: "A chart", text: "A chart, 1 to 2. 2: Y 3." };

describe("ChartFrame — axe-core", () => {
  it.each([
    [
      "a line chart",
      <LineChart key="l" data={[{ x: 1, y: 2 }]}>
        <Line dataKey="y" />
      </LineChart>,
    ],
    [
      "a bar chart",
      <BarChart key="b" data={[{ x: 1, y: 2 }]}>
        <Bar dataKey="y" />
      </BarChart>,
    ],
  ])("%s renders without violations", async (_name, chart) => {
    const { container } = render(
      <div>
        <ChartFrame summary={summary}>{chart}</ChartFrame>
      </div>,
    );
    expect(container.querySelector("svg[role='img']")).not.toBeNull();
    const results = await axe.run(
      container as axe.ElementContext,
      { rules: { "color-contrast": { enabled: false } } } as axe.RunOptions,
    );
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
