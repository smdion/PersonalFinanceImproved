/** A SimpleFIN feed still listed by every sync but whose balance stopped
 *  moving: the institution's connection at SimpleFIN Bridge is broken, and
 *  only reconnecting it there brings new reports. */
import { addDays } from "@/lib/utils/date";
import { easternDay } from "../investments/market-calendar";
import { latestSyncAt } from "./simplefin-reidentify";

/** Calendar days a feed's balance date may trail before it's stale. */
export const STALE_FEED_DAYS = 2;

type FeedRow = {
  id: number;
  orgName: string;
  isIncluded: boolean;
  /** Loan feeds report about monthly: never compared. */
  linkedLoanId: number | null;
  lastBalanceDate: Date | null;
  lastSeenAt: Date;
};

export type StaleFeed = {
  id: number;
  institution: string;
  /** The day of its last balance (Eastern calendar day). */
  balanceDay: string;
};

/** Included feeds the latest sync listed whose balance trails the other
 *  institutions' newest by over STALE_FEED_DAYS (alone: its own last seen).
 *  One the latest sync didn't list is gone, not stuck: never stale here. */
export function staleFeeds(rows: readonly FeedRow[]): StaleFeed[] {
  const latest = latestSyncAt(rows);
  const dated = rows.flatMap((r) =>
    r.isIncluded && r.linkedLoanId === null && r.lastBalanceDate
      ? [{ ...r, day: easternDay(r.lastBalanceDate) }]
      : [],
  );
  return dated.flatMap((r) => {
    if (latest === null || r.lastSeenAt.getTime() < latest.getTime()) return [];
    const others = dated.filter((o) => o.orgName !== r.orgName);
    const newest =
      others.length > 0
        ? others.map((o) => o.day).sort()[others.length - 1]!
        : easternDay(r.lastSeenAt);
    return newest > addDays(r.day, STALE_FEED_DAYS)
      ? [{ id: r.id, institution: r.orgName, balanceDay: r.day }]
      : [];
  });
}
