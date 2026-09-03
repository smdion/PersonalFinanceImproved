"use client";

import { useState } from "react";
import Link from "next/link";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

export function HelpTip({
  text,
  lines,
  maxWidth,
  learnMoreHref,
}: {
  text?: string;
  lines?: (string | React.ReactNode)[];
  maxWidth?: number;
  /** Optional in-app link shown at the bottom of the tooltip */
  learnMoreHref?: string;
}) {
  const [open, setOpen] = useState(false);
  const label =
    text ??
    (lines ? lines.filter((line) => typeof line === "string").join(" ") : "");
  const resolvedMaxWidth = maxWidth ?? 280;

  const resolvedContent =
    lines && lines.length > 0 ? (
      <div className="flex flex-col gap-0.5">
        {lines.map((line, i) => (
          <div key={typeof line === "string" ? line : `line-${i}`}>{line}</div>
        ))}
      </div>
    ) : text ? (
      text
    ) : null;

  if (!resolvedContent) return null;

  return (
    <TooltipPrimitive.Root
      delayDuration={200}
      open={open}
      onOpenChange={setOpen}
    >
      <TooltipPrimitive.Trigger asChild>
        <span
          className="bg-surface-strong text-muted text-caption ml-1 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full font-bold"
          aria-label={label}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((prev) => !prev);
          }}
        >
          ?
        </span>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side="top"
          align="center"
          sideOffset={5}
          avoidCollisions
          collisionPadding={12}
          className="text-label animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 z-[9999] rounded-lg bg-slate-900 px-3.5 py-2.5 leading-relaxed text-slate-100 shadow-xl dark:bg-slate-700"
          style={{ maxWidth: resolvedMaxWidth }}
          onPointerDownOutside={() => setOpen(false)}
        >
          {resolvedContent}
          {learnMoreHref && (
            <Link
              href={learnMoreHref}
              className="text-label mt-1.5 block text-sky-400 hover:text-sky-300"
              onClick={() => setOpen(false)}
            >
              Learn more →
            </Link>
          )}
          <TooltipPrimitive.Arrow className="fill-slate-900 dark:fill-slate-700" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
