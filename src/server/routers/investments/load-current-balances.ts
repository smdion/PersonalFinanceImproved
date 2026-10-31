/**
 * The Current Balances figures: the most accurate balance for each tracked
 * account (lib/pure/current-balances.ts), part by part, with the market day
 * each feed's data really is from (lib/pure/feed-data-date.ts). Reads only
 * — nothing here is written to a snapshot or to Performance.
 */
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { addDays, localDateStr } from "@/lib/utils/date";
import {
  currentBalance,
  pairFeedsWithParts,
  snapshotDataDay,
  summarizeCurrentBalances,
  type BalanceFeed,
} from "@/lib/pure/current-balances";
import {
  feedDataDay,
  learnReportLag,
  provenDataDay,
  type DataDateBasis,
} from "@/lib/pure/feed-data-date";
import {
  reportCalendarDay,
  valuationDateFor,
} from "@/lib/pure/market-calendar";
import { loadTrackedAccountNames } from "@/server/helpers/account-names";
import { getDailyMarketCloses } from "@/server/helpers/market-prices";
import { loadAccounts, loadFeedContext, loadLatestHoldings } from "./_shared";

type Db = Parameters<typeof loadFeedContext>[0];

/** Days of closes before the oldest date in play — enough for a long
 *  weekend and a feed a few sessions behind. */
const CLOSE_WINDOW_DAYS = 10;

/** One page load asks from several places: share the work briefly. */
const SHARE_MS = 5_000;
const shared = new WeakMap<
  object,
  { at: number; result: ReturnType<typeof computeCurrentBalances> }
>();

export function loadCurrentBalances(db: Db) {
  const hit = shared.get(db);
  if (hit && Date.now() - hit.at < SHARE_MS) return hit.result;
  const result = computeCurrentBalances(db);
  shared.set(db, { at: Date.now(), result });
  return result;
}

/** Each feed's balance reports, oldest first. */
async function loadBalanceReports(db: Db) {
  const b = schema.simplefinAccountBalances;
  const rows = await db.select().from(b).orderBy(asc(b.balanceDate));
  const byFeed = new Map<number, { reportedAt: Date; balance: number }[]>();
  for (const r of rows) {
    const list = byFeed.get(r.simplefinAccountId) ?? [];
    list.push({ reportedAt: r.balanceDate, balance: Number(r.balance) });
    byFeed.set(r.simplefinAccountId, list);
  }
  return byFeed;
}

async function computeCurrentBalances(db: Db) {
  const f = schema.simplefinAccounts;
  const [context, accounts, holdings, reports, names, latestSnapshot, loose] =
    await Promise.all([
      loadFeedContext(db),
      loadAccounts(db),
      loadLatestHoldings(db),
      loadBalanceReports(db),
      loadTrackedAccountNames(db),
      db
        .select()
        .from(schema.portfolioSnapshots)
        .orderBy(desc(schema.portfolioSnapshots.snapshotDate))
        .limit(1)
        .then((r) => r[0] ?? null),
      // Included but matched to nothing: counted, never compared.
      db
        .select({
          id: f.id,
          balance: f.lastBalance,
          balanceDate: f.lastBalanceDate,
          lastSeenAt: f.lastSeenAt,
        })
        .from(f)
        .where(
          and(eq(f.isIncluded, true), isNull(f.linkedPerformanceAccountId)),
        ),
    ]);
  const { subs } = context;
  const allFeeds = [
    ...context.feeds.map((x) => ({
      id: x.id,
      performanceAccountId: x.performanceAccountId as number | null,
      subKey: x.subKey,
      balance: x.balance,
      reportedAt: x.reportedAt,
      lastSeenAt: x.lastSeenAt,
    })),
    ...loose.map((x) => ({
      id: x.id,
      performanceAccountId: null,
      subKey: null,
      balance: Number(x.balance),
      reportedAt: x.balanceDate,
      lastSeenAt: x.lastSeenAt,
    })),
  ];
  const snapshotDay = latestSnapshot
    ? snapshotDataDay(latestSnapshot.snapshotDate, latestSnapshot.createdAt)
    : null;
  const seenAt = (x: (typeof allFeeds)[number]) => x.reportedAt ?? x.lastSeenAt;
  const institutionOf = (id: number) => accounts.get(id)?.institution ?? "";
  const positionsOfFeed = (id: number) =>
    holdings.filter((h) => h.simplefinAccountId === id);

  // Closes for every held fund, back far enough for every date in play.
  const earliest = [
    ...allFeeds.map((x) => valuationDateFor(seenAt(x))),
    ...(snapshotDay ? [snapshotDay] : []),
  ].sort()[0];
  const closesFrom = addDays(earliest ?? localDateStr(), -CLOSE_WINDOW_DAYS);
  const tickers = [
    ...new Set(holdings.map((h) => h.ticker).filter((t): t is string => !!t)),
  ];
  const closes = new Map(
    (
      await Promise.all(
        tickers.map(
          async (t) =>
            [t, await getDailyMarketCloses(db, t, closesFrom)] as const,
        ),
      )
    ).flatMap(([t, c]) => (c ? ([[t, c]] as const) : [])),
  );

  // Each institution's lag, from its market feeds only — a cash account at
  // the same institution says nothing about when prices post.
  const marketByInstitution = new Map<string, number[]>();
  for (const x of allFeeds) {
    if (positionsOfFeed(x.id).length === 0) continue;
    const name = institutionOf(x.id);
    marketByInstitution.set(name, [
      ...(marketByInstitution.get(name) ?? []),
      x.id,
    ]);
  }
  const lagOf = new Map(
    [...marketByInstitution].map(([name, ids]) => [
      name,
      learnReportLag(ids.map((id) => reports.get(id) ?? [])),
    ]),
  );
  const marketDay = (id: number, at: Date, proven: string | null) =>
    feedDataDay({
      reportedAt: at,
      proven,
      learned: lagOf.get(institutionOf(id)) ?? null,
    });

  const feedDates = new Map(
    allFeeds.map((x) => {
      const at = seenAt(x);
      const positions = positionsOfFeed(x.id);
      // Only positions sent with this very report can prove its date.
      const fromThisReport = positions.filter(
        (h) => h.balanceDate?.getTime() === x.reportedAt?.getTime(),
      );
      const dated: { day: string; basis: DataDateBasis | "reported" } =
        positions.length > 0
          ? marketDay(
              x.id,
              at,
              provenDataDay(fromThisReport, closes, valuationDateFor(at)),
            )
          : { day: reportCalendarDay(at), basis: "reported" };
      return [
        x.id,
        { ...dated, reportedAt: at, timeKnown: x.reportedAt !== null },
      ] as const;
    }),
  );

  const toPairing = (x: (typeof allFeeds)[number]): BalanceFeed => ({
    id: x.id,
    performanceAccountId: x.performanceAccountId,
    subKey: x.subKey,
    balance: x.balance,
    // No time from the institution: how old it is can't be told.
    dataDay: x.reportedAt ? feedDates.get(x.id)!.day : null,
  });
  const inputs = pairFeedsWithParts({
    feeds: allFeeds.map(toPairing),
    parts: subs,
    accountName: (id) => names.get(id) ?? "",
    feedName: (id) => accounts.get(id)?.feedName ?? "",
    positionsOf: (ids) =>
      holdings
        .filter((h) => ids.includes(h.simplefinAccountId))
        .map((h) => ({
          shares: h.shares,
          closes: (h.ticker ? closes.get(h.ticker) : null) ?? null,
          feedDay: feedDates.get(h.simplefinAccountId)?.day ?? null,
        })),
  });

  // A snapshot amount copied from a feed holds that report's data, whatever
  // day the snapshot was saved.
  const snapshotFigureDay = (feedId: number, amount: number) => {
    const match = [...(reports.get(feedId) ?? [])]
      .reverse()
      .find(
        (r) =>
          Math.abs(r.balance - amount) < 0.01 &&
          (!latestSnapshot || r.reportedAt <= latestSnapshot.createdAt),
      );
    if (!match) return null;
    return positionsOfFeed(feedId).length > 0
      ? marketDay(feedId, match.reportedAt, null).day
      : reportCalendarDay(match.reportedAt);
  };
  const dated = inputs.map((a) => {
    const linked = allFeeds.filter((x) =>
      a.key.startsWith("account:")
        ? x.performanceAccountId === a.performanceAccountId
        : x.subKey === a.key,
    );
    return linked.length === 1 && !a.noSnapshot
      ? { ...a, snapshotDay: snapshotFigureDay(linked[0]!.id, a.snapshot) }
      : a;
  });

  const balances = dated.map((a) => currentBalance(a, snapshotDay ?? ""));
  const behindFeed = (x: (typeof allFeeds)[number]) => {
    if (snapshotDay === null || x.performanceAccountId === null) return false;
    const entry = balances.find(
      (b) =>
        b.performanceAccountId === x.performanceAccountId &&
        (b.key.startsWith("account:") || b.key === x.subKey),
    );
    return entry?.source === "snapshot";
  };
  return {
    snapshotDate: latestSnapshot?.snapshotDate ?? null,
    snapshotDay,
    balances,
    summary: summarizeCurrentBalances(balances),
    /** Each feed's data date, for the "as of" detail. */
    feeds: allFeeds.map((x) => {
      const d = feedDates.get(x.id)!;
      return {
        id: x.id,
        institution: institutionOf(x.id),
        dataDay: d.day,
        basis: d.basis,
        reportedAt: d.reportedAt,
        timeKnown: d.timeKnown,
        behindSnapshot: behindFeed(x),
      };
    }),
  };
}
