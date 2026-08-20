"use client";

/**
 * useClickOutside — the "close this dropdown on an outside click" effect
 * reinvented identically in profile-pill.tsx and scenario-bar.tsx (Batch 29
 * Finding 11: copy-pasted verbatim in the same directory rather than
 * extracted, even as a minimal shared hook).
 *
 *   const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));
 *   <div ref={ref}>...</div>
 */

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

export function useClickOutside<T extends HTMLElement>(
  onOutsideClick: () => void,
): RefObject<T | null> {
  const ref = useRef<T>(null);
  // Mirrors the original mount-once listener attachment exactly (both
  // originals used an empty dependency array): the ref-to-latest-callback
  // pattern avoids stale closures without needing to reattach the
  // document listener on every render just because an inline arrow
  // function gave the callback a new identity. The ref is updated in an
  // effect, not during render (React disallows mutating a ref while
  // rendering) — useLayoutEffect so it's current before any listener
  // could plausibly fire.
  const callbackRef = useRef(onOutsideClick);
  useLayoutEffect(() => {
    callbackRef.current = onOutsideClick;
  });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        callbackRef.current();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return ref;
}
