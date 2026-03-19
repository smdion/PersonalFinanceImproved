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

/* ── Grid ───────────────────────────────────────────────────────── */

export const gridProps = {
  strokeDasharray: "3 3",
  stroke: CHART_COLORS.mcGrid,
  /** Dark mode handled via CSS variable override in globals.css. */
} as const;

/* ── Axis ───────────────────────────────────────────────────────── */

export const axisProps = {
  tick: { fontSize: 12, fill: CHART_COLORS.mcAxis },
} as const;

export const yAxisProps = {
  ...axisProps,
  tick: { fontSize: 11, fill: CHART_COLORS.mcAxis },
  width: 65,
} as const;

/* ── Tooltip ────────────────────────────────────────────────────── */

export const tooltipProps = {
  contentStyle: { fontSize: 12 },
} as const;

/* ── Legend ──────────────────────────────────────────────────────── */

export const legendProps = {
  wrapperStyle: { fontSize: 11, lineHeight: "1.5", paddingTop: 4 },
} as const;

/* ── Standard margins ───────────────────────────────────────────── */

export const chartMargin = {
  top: 5,
  right: 20,
  left: 10,
  bottom: 5,
} as const;

/* ── Formatters ─────────────────────────────────────────────────── */

/** Compact currency for Y-axis ticks: $1.2M, $450k, $800 */
export function compactCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000)
    return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return `$${value.toFixed(0)}`;
}

/** Compact number for Y-axis ticks: 1.2M, 450k, 800 */
export function compactNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000)
    return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return value.toFixed(0);
}
