"use client";

/**
 * Shared chart styling defaults for Recharts.
 *
 * Usage: spread these props onto Recharts components for consistent styling.
 * Colors reference CHART_COLORS from @/lib/utils/colors — never define local hex values.
 *
 * @example
 * <CartesianGrid {...gridProps} />
 * <XAxis dataKey="year" {...axisProps} />
 * <YAxis {...axisProps} tickFormatter={compactCurrency} width={65} />
 * <RechartsTooltip {...tooltipProps} formatter={...} />
 * <Legend {...legendProps} />
 */

import { CHART_COLORS } from "@/lib/utils/colors";

/* ── Canonical font sizes ────────────────────────────────────────
 * Mirrors the CSS token scale for SVG/inline-style contexts where
 * Tailwind classes can't be applied to Recharts SVG text nodes.
 *
 *   CHART_FONT.tick    : 11px — axis ticks, legend items  (= text-caption)
 *   CHART_FONT.xTick   : 12px — x-axis date/category ticks (= text-xs)
 *   CHART_FONT.tooltip : 12px — tooltip content            (= text-xs)
 *   CHART_FONT.legend  : 11px — legend labels              (= text-caption)
 *   CHART_FONT.label   : 10px — inline bar/line labels     (= text-micro)
 *   CHART_FONT.tiny    :  9px — mini charts / compressed space only
 */
export const CHART_FONT = {
  xTick: 12,
  tick: 11,
  tooltip: 12,
  legend: 11,
  label: 10,
  tiny: 9,
} as const;

/* ── Grid ───────────────────────────────────────────────────────── */

export const gridProps = {
  strokeDasharray: "3 3",
  stroke: CHART_COLORS.mcGrid,
  /** Dark mode handled via CSS variable override in globals.css. */
} as const;

/* ── Axis ───────────────────────────────────────────────────────── */

export const axisProps = {
  tick: { fontSize: CHART_FONT.xTick, fill: CHART_COLORS.mcAxis },
} as const;

export const yAxisProps = {
  ...axisProps,
  tick: { fontSize: CHART_FONT.tick, fill: CHART_COLORS.mcAxis },
  width: 65,
} as const;

/* ── Tooltip ────────────────────────────────────────────────────── */

export const tooltipProps = {
  contentStyle: { fontSize: CHART_FONT.tooltip },
} as const;

/* ── Legend ──────────────────────────────────────────────────────── */

export const legendProps = {
  wrapperStyle: {
    fontSize: CHART_FONT.legend,
    lineHeight: "1.5",
    paddingTop: 4,
  },
} as const;

/* ── Standard margins ───────────────────────────────────────────── */

export const chartMargin = {
  top: 5,
  right: 20,
  left: 10,
  bottom: 5,
} as const;

/* ── Formatters ─────────────────────────────────────────────────── */

export { compactCurrency } from "@/lib/utils/format";

/** Compact number for Y-axis ticks: 1.2M, 450k, 800 */
export function compactNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return value.toFixed(0);
}
