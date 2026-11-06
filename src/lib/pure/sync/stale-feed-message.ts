/** The words for a stale SimpleFIN feed (stale-feeds.ts), apart from the
 *  rule so the pages that show them don't load it. */
import { shortDay } from "../net-worth/short-day";
import type { StaleFeed } from "./stale-feeds";

/** One line per institution with a stale feed, from its newest balance:
 *  "Voya hasn't updated since Nov 1: reconnect it in SimpleFIN Bridge". */
export function staleFeedMessages(stale: readonly StaleFeed[]): {
  institution: string;
  message: string;
}[] {
  const since = new Map<string, string>();
  for (const s of stale) {
    const day = since.get(s.institution);
    if (!day || s.balanceDay > day) since.set(s.institution, s.balanceDay);
  }
  return [...since].map(([institution, day]) => ({
    institution,
    message: `${institution.split(/\s+/)[0] || "An institution"} hasn't updated since ${shortDay(day)}: reconnect it in SimpleFIN Bridge`,
  }));
}
