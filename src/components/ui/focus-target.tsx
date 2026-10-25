"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import type { FocusIds, FocusKey } from "@/lib/config/focus-topics";
import { useFocusMatch } from "@/lib/hooks/use-focus";

/** Brief ring on the section a link landed on (styled in globals.css). */
const LANDED_ATTR = "data-focus-landed";
const HIGHLIGHT_MS = 2000;
/** Content above may still be loading (charts, simulations): keep the
 *  target in view while the page changes size, for this long. */
const SETTLE_MS = 3000;

/**
 * Scroll `ref` into view and ring it briefly when `active` turns true. For elements a wrapper `<div>` can't go around (a table
 * row); everything else uses `FocusTarget`.
 */
export function useScrollToFocus(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
) {
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    let userScrolled = false;
    const stop = () => {
      userScrolled = true;
    };
    const events = ["wheel", "touchstart", "keydown"] as const;
    for (const e of events)
      window.addEventListener(e, stop, { once: true, passive: true });
    const scroll = () => {
      if (!userScrolled) el.scrollIntoView({ block: "center" });
    };
    const frame = requestAnimationFrame(scroll);
    const resized = new ResizeObserver(scroll);
    resized.observe(document.body);
    const settle = setTimeout(() => resized.disconnect(), SETTLE_MS);
    el.setAttribute(LANDED_ATTR, "");
    const unring = setTimeout(
      () => el.removeAttribute(LANDED_ATTR),
      HIGHLIGHT_MS,
    );
    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
      clearTimeout(settle);
      clearTimeout(unring);
      el.removeAttribute(LANDED_ATTR);
      for (const e of events) window.removeEventListener(e, stop);
    };
  }, [ref, active]);
}

/**
 * Marks a section a focus link can land on: scrolled to and ringed when the
 * URL's focus is `topic` (and, for topics with an id, when `matches` says
 * this is the one).
 */
export function FocusTarget<K extends FocusKey>({
  topic,
  matches,
  className,
  children,
}: {
  topic: K;
  matches?: (ids: FocusIds<K>) => boolean;
  className?: string;
  children: ReactNode;
}) {
  const ids = useFocusMatch(topic);
  const ref = useRef<HTMLDivElement>(null);
  useScrollToFocus(ref, ids !== null && (!matches || matches(ids)));
  return (
    <div ref={ref} className={className} data-focus-topic={topic}>
      {children}
    </div>
  );
}
