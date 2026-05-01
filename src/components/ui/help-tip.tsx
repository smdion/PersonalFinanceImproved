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
    text ?? (lines ? lines.filter((l) => typeof l === "string").join(" ") : "");
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
          className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-surface-strong text-muted text-[10px] font-bold cursor-help ml-1"
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
          className="z-[9999] rounded-lg bg-slate-900 dark:bg-slate-700 px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-100 shadow-xl animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
          style={{ maxWidth: resolvedMaxWidth }}
          onPointerDownOutside={() => setOpen(false)}
        >
          {resolvedContent}
          {learnMoreHref && (
            <Link
              href={learnMoreHref}
              className="block mt-1.5 text-[11px] text-sky-400 hover:text-sky-300"
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
