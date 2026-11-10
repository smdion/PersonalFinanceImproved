"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

/**
 * Always-dark tooltip surface in both themes (slate is not theme-remapped); custom tooltips (e.g.
 * Recharts) reuse it. Text inside must read on slate-900 and slate-700 without `--c-*` colors;
 * see retirement-projection/projection-display.ts's `tipColorClass`.
 */
export const TOOLTIP_SURFACE_CLASSES =
  "rounded-lg bg-slate-900 dark:bg-slate-700 px-3.5 py-2.5 text-label leading-relaxed text-slate-100 shadow-xl";

/** Radix-based tooltip: `content` (text or rich JSX) or `lines` (one line per string). */
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
