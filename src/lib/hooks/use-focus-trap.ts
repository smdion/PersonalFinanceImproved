"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The container's visible, enabled focusable elements, in Tab order. */
function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null,
  );
}

/**
 * Sends focus into the container from outside it: its first focusable
 * element, its last when `backwards`, or the container when it has none.
 */
export function focusInto(container: HTMLElement, backwards: boolean) {
  const focusable = focusableIn(container);
  const target = backwards ? focusable[focusable.length - 1] : focusable[0];
  (target ?? container).focus();
}

/**
 * Traps keyboard focus within a container while `active` is true.
 * Returns a ref to attach to the container element.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const containerRef = useRef<T>(null);

  useEffect(() => {
    if (!active || !containerRef.current) return;

    const container = containerRef.current;

    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      const focusable = focusableIn(container);

      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      // The container itself (focused on open) counts as before the first.
      const focused = document.activeElement;
      if (e.shiftKey && (focused === first || focused === container)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (focused === last || focused === container)) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", handler);
    return () => container.removeEventListener("keydown", handler);
  }, [active]);

  return containerRef;
}
