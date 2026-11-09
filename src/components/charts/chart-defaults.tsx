"use client";

/**
 * Shared Recharts styling props to spread onto chart components.
 * Colors come from CHART_COLORS in @/lib/utils/colors; never define local hex values.
 */

import { CHART_COLORS } from "@/lib/utils/colors";

/* Canonical font sizes (px) for Recharts SVG text, where Tailwind classes can't apply.
 * Mirrors the CSS tokens: tick/legend = text-caption, xTick/tooltip = text-xs,
 * label = text-micro; tiny is for mini charts / compressed space only. */
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
