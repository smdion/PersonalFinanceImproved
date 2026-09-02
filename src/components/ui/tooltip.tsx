"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

/**
 * This tooltip's surface is intentionally NOT theme-adaptive — bg-slate-900
 * in light page-mode, dark:bg-slate-700 in dark page-mode, both genuinely
 * dark. Neither shade has a `--c-slate-*` override in globals.css (slate
 * isn't part of that remapping system), so this stays exactly as fixed as
 * it looks: a deliberately-always-dark, high-contrast surface regardless
 * of the page's own theme (a common, defensible choice for transient hover
 * UI). Exported so any custom tooltip surface elsewhere in the app (e.g. a
 * chart's own hand-rolled Recharts tooltip, which can't use this component
 * directly since Recharts drives its own hover/positioning via a `content`
 * render prop) can match it exactly instead of drifting to a THEME-
 * ADAPTIVE surface (`bg-surface-primary` etc.) — mixing the two is exactly
 * what produced "light mode chart = light background, table = dark
 * background" (live user finding, 2026-08-30). Any text color used inside
 * this surface must be legible on both bg-slate-900 AND bg-slate-700 —
 * NOT run through globals.css's `--c-*` page-theme remapping, which
 * assumes a theme-adaptive container and will actively fight this fixed
 * one. See cards/projection/utils.ts's `tipColorClass` for the curated set
 * used by the projection chart/table tooltips specifically.
 */
export const TOOLTIP_SURFACE_CLASSES =
  "rounded-lg bg-slate-900 dark:bg-slate-700 px-3.5 py-2.5 text-label leading-relaxed text-slate-100 shadow-xl";

/**
 * Radix-based tooltip with Tailwind styling.
 *
 * Usage (inline):
 *   <Tooltip content="Simple text">
 *     <span>Hover me</span>
 *   </Tooltip>
 *
 * Usage (rich content):
 *   <Tooltip content={<div><strong>Title</strong><br/>Details</div>}>
 *     <span>Hover me</span>
 *   </Tooltip>
 *
 * Usage (multi-line shorthand):
 *   <Tooltip lines={['Line 1', 'Line 2', 'Line 3']}>
 *     <span>Hover me</span>
 *   </Tooltip>
 */
export function Tooltip({
  children,
  content,
  lines,
  side = "top",
  align = "center",
  delayDuration = 200,
  maxWidth = 320,
}: {
  children: React.ReactNode;
  content?: React.ReactNode;
  lines?: (string | React.ReactNode)[];
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  delayDuration?: number;
  maxWidth?: number;
}) {
  const resolvedContent =
    content ??
    (lines && lines.length > 0 ? (
      <div className="flex flex-col gap-0.5">
        {lines.map((line, i) => (
          <div key={typeof line === "string" ? line : `line-${i}`}>{line}</div>
        ))}
      </div>
    ) : null);

  if (!resolvedContent) return <>{children}</>;

  return (
    <TooltipPrimitive.Root delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          avoidCollisions
          collisionPadding={12}
          className={`z-[9999] ${TOOLTIP_SURFACE_CLASSES} animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95`}
          style={{ maxWidth }}
        >
          {resolvedContent}
          <TooltipPrimitive.Arrow className="fill-slate-900 dark:fill-slate-700" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/** Wrap the app with this provider to enable tooltips globally. */
export const TooltipProvider = TooltipPrimitive.Provider;
