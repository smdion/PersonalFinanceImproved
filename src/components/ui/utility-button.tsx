"use client";

import type { ReactNode } from "react";

const PILL =
  "text-label flex flex-1 items-center justify-center gap-1 rounded px-1.5 py-1 transition-colors";

/** A sidebar utility control (theme, privacy): icon-only, or a pill filled
 *  blue while `pressed`. `pressed` is left off a control with no on state. */
export function UtilityButton({
  shape,
  pressed,
  ariaLabel,
  title,
  onClick,
  children,
}: {
  shape: "icon" | "pill";
  pressed?: boolean;
  ariaLabel: string;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const className =
    shape === "icon"
      ? "text-faint hover:text-primary p-1 transition-colors"
      : `${PILL} ${pressed ? "bg-blue-600 text-white" : "text-faint hover:text-primary hover:bg-surface-primary"}`;
  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
      aria-label={ariaLabel}
      aria-pressed={pressed}
      title={title}
    >
      {children}
    </button>
  );
}
