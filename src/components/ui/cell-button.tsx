"use client";

import type { ReactNode } from "react";

/**
 * A clickable cell's content as a button with no handler: its click (or
 * Enter/Space) bubbles to the cell's `onClick`; plain content when not `enabled`.
 */
export function CellButton({
  enabled = true,
  pressed,
  children,
}: {
  enabled?: boolean;
  /** A switch's state (`aria-pressed`): the cell picks a mode. */
  pressed?: boolean;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className="cursor-[inherit] [text-align:inherit]"
    >
      {children}
    </button>
  );
}
