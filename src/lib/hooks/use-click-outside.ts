"use client";

/**
 * Calls back on a document-wide mousedown outside the ref'd element (touch
 * counts via synthesized mouse events). Usage: `<div ref={useClickOutside(close)}>`.
 */

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

export function useClickOutside<T extends HTMLElement>(
  onOutsideClick: () => void,
): RefObject<T | null> {
  const ref = useRef<T>(null);
  // Latest-callback ref: the document listener attaches once yet never calls a
  // stale closure. Updated in a layout effect, since refs can't change in render.
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
