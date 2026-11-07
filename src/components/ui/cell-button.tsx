"use client";

import type { ReactNode } from "react";

/**
 * A clickable cell's content as a button with no handler: its click (or
 * Enter/Space) bubbles to the cell's `onClick`; plain content when not `enabled`.
 */
export function CellButton({
  enabled = true,
  children,
}: {
  enabled?: boolean;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <button type="button" className="cursor-[inherit] [text-align:inherit]">
      {children}
    </button>
  );
}
