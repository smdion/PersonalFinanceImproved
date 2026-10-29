"use client";

import { useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  FOCUS_ID_PARAM,
  FOCUS_PARAM,
  focusStateFor,
  isFocusKey,
  parseFocusIds,
  type FocusIds,
  type FocusKey,
  type FocusStateKey,
  type FocusStateValue,
} from "@/lib/config/focus-topics";

/** Drop query params without a scroll or a history entry. */
export function useClearParams(): (params: readonly string[]) => void {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (params) => {
      const stale = params.filter((p) => searchParams.has(p));
      if (stale.length === 0) return;
      const next = new URLSearchParams(searchParams);
      for (const p of stale) next.delete(p);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname],
  );
}

/** The focus a link opened this page with — read from the URL every render. */
function useFocus(): {
  topic: FocusKey | null;
  idValue: string | null;
  clearFocus: () => void;
} {
  const searchParams = useSearchParams();
  const clearParams = useClearParams();
  const raw = searchParams.get(FOCUS_PARAM);
  const clearFocus = useCallback(
    () => clearParams([FOCUS_PARAM, FOCUS_ID_PARAM]),
    [clearParams],
  );
  return {
    topic: isFocusKey(raw) ? raw : null,
    idValue: searchParams.get(FOCUS_ID_PARAM),
    clearFocus,
  };
}

/**
 * Is this page being asked to show `topic`? Its ids when it is (an empty
 * object for a topic without one), null when not — or when the id is
 * missing or stale (a deleted goal), so nothing is revealed or scrolled to.
 * A section that may be hidden (collapsed, filtered out, another tab)
 * reveals itself from this.
 */
export function useFocusMatch<K extends FocusKey>(
  topic: K,
): FocusIds<K> | null {
  const focus = useFocus();
  if (focus.topic !== topic) return null;
  return parseFocusIds(topic, focus.idValue);
}

/**
 * A page's own tab/view state that a focus link can set. The focus wins for
 * display and is copied into local state when it arrives, so clearing it
 * (on any choice the user makes) never snaps a tab back. Choosing a value
 * clears the focus. Never writes saved settings.
 */
export function useFocusedState<S extends FocusStateKey>(
  key: S,
  initial: FocusStateValue<S>,
): [FocusStateValue<S>, (value: FocusStateValue<S>) => void] {
  const { topic, clearFocus } = useFocus();
  const fromFocus = focusStateFor(topic, key);
  const [local, setLocal] = useState<FocusStateValue<S>>(fromFocus ?? initial);
  // Copy a newly arrived focus into local state (adjusting state during
  // render — React's pattern for following a changing input).
  const [seen, setSeen] = useState(fromFocus);
  if (seen !== fromFocus) {
    setSeen(fromFocus);
    if (fromFocus !== undefined) setLocal(fromFocus);
  }
  const set = useCallback(
    (value: FocusStateValue<S>) => {
      setLocal(value);
      if (topic) clearFocus();
    },
    [topic, clearFocus],
  );
  return [fromFocus ?? local, set];
}

/**
 * A collapsed section a link can land on: opens when the focus for `topic`
 * (and, for topics with an id, the one `matches` accepts) arrives, and the
 * user can still close it (closing doesn't reopen).
 */
export function useFocusReveal<K extends FocusKey>(
  topic: K,
  matches?: (ids: FocusIds<K>) => boolean,
  initial = false,
): [boolean, (open: boolean) => void] {
  const ids = useFocusMatch(topic);
  const matched = ids !== null && (!matches || matches(ids));
  const [open, setOpen] = useState(initial || matched);
  const [seen, setSeen] = useState(matched);
  if (seen !== matched) {
    setSeen(matched);
    if (matched) setOpen(true);
  }
  return [open, setOpen];
}
