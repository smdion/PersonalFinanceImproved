"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

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
          <div key={i}>{line}</div>
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
          className="z-[9999] rounded-lg bg-slate-900 px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-100 shadow-xl animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
          style={{ maxWidth }}
        >
          {resolvedContent}
          <TooltipPrimitive.Arrow className="fill-slate-900" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/** Wrap the app with this provider to enable tooltips globally. */
export const TooltipProvider = TooltipPrimitive.Provider;
