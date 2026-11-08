"use client";

/**
 * The frame every Recharts chart renders in: the responsive container, and
 * the chart named as an image (`role="img"`, its keyboard layer on) and
 * described by an sr-only summary of the values it plots.
 */
import { cloneElement, useId, type ReactElement } from "react";
import { ResponsiveContainer } from "recharts";
import type { ChartSummary } from "./chart-summary";
import { ChartSummaryText } from "./chart-summary-text";

type ChartRootProps = {
  accessibilityLayer?: boolean;
  role?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
};

export function ChartFrame({
  summary,
  height = "100%",
  children,
}: {
  summary: ChartSummary;
  height?: number | `${number}%`;
  children: ReactElement<ChartRootProps>;
}) {
  const id = useId();
  return (
    <>
      <ChartSummaryText id={id} text={summary.text} />
      <ResponsiveContainer width="100%" height={height}>
        {cloneElement(children, {
          accessibilityLayer: true,
          role: "img",
          "aria-label": summary.label,
          "aria-describedby": id,
        })}
      </ResponsiveContainer>
    </>
  );
}
