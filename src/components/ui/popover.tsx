"use client";

import type { CSSProperties, ReactNode } from "react";

/** Over its card (a menu inside it) or over the page (portaled to body). */
const LAYER = {
  card: { catcher: "z-10", panel: "z-20" },
  page: { catcher: "z-40", panel: "z-50" },
} as const;

/**
 * A popover's panel over a click-catcher: a click outside closes it and is
 * swallowed, so it doesn't also act on what's underneath.
 */
export function Popover({
  onClose,
  layer,
  className,
  style,
  children,
}: {
  onClose: () => void;
  layer: keyof typeof LAYER;
  /** The panel's own classes: position, size, surface, border, padding. */
  className: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <>
      <div
        className={`fixed inset-0 ${LAYER[layer].catcher}`}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        role="presentation"
      />
      <div className={`${className} ${LAYER[layer].panel}`} style={style}>
        {children}
      </div>
    </>
  );
}
