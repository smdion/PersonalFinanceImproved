/**
 * The Current Balances figures: the most accurate balance for each tracked
 * account (lib/pure/current-balances.ts), part by part, with the market day
 * each feed's data really is from (lib/pure/feed-data-date.ts). Reads only
 * — nothing here is written to a snapshot or to Performance.
 */
import { and, asc, desc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { addDays } from "@/lib/utils/date";
import {
  currentBalance,
  addedIntoClose,
  moveIntoClose,
  pairFeedsWithParts,
  snapshotDataDay,
  summarizeCurrentBalances,
  type BalanceFeed,
  type DailyClose,
} from "@/lib/pure/current-balances";
import {
  feedDataDay,
  learnReportLag,
  provenDataDay,
  type DataDateBasis,
} from "@/lib/pure/feed-data-date";
import {
  previousTradingDay,
  reportCalendarDay,
  valuationDateFor,
} from "@/lib/pure/market-calendar";
import { dailyMovement } from "@/lib/pure/daily-movement";

/** Transactions that change share counts: money in and out, dividends and
 *  interest (reinvested), fees. Trades and sweeps move money inside. */
const SHARE_CHANGING_KINDS = new Set([
  "contribution",
  "withdrawal",
  "dividend",
  "interest",
  "fee",
]);
import { impliedUnitPrices } from "@/lib/pure/fund-prices";
import { CASH_LIKE_SECURITY_KINDS } from "@/lib/config/enum-values";
import { loadTrackedAccountNames } from "@/server/helpers/account-names";
import { getDailyMarketCloses } from "@/server/helpers/market-prices";
import {
  loadAccounts,
  loadClassifiedTransactions,
  loadFeedContext,
  loadLatestHoldings,
} from "./_shared";
import type { Db } from "@/lib/db";

/** Days of closes before the oldest date in play — enough for a long
 *  weekend and a feed a few sessions behind. */
const CLOSE_WINDOW_DAYS = 10;

/** Closes shown under Daily movement. */
const MOVEMENT_SESSIONS = 5;
/** Calendar days those closes can span (a long weekend included). */
const MOVEMENT_WINDOW_DAYS = 10;

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
          and(
            eq(f.isIncluded, true),
            isNull(f.linkedPerformanceAccountId),
            isNull(f.linkedLoanId),
            gte(f.lastBalance, "0"),
          ),
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
  const today = valuationDateFor(new Date());
  const closesFrom = addDays(
    [earliest ?? today, addDays(today, -MOVEMENT_WINDOW_DAYS)].sort()[0]!,
    -CLOSE_WINDOW_DAYS,
  );
  const history = await loadHoldingHistory(db, closesFrom);
  const tickers = [
    ...new Set(
      history.flatMap((h) =>
        h.ticker && !CASH_LIKE_SECURITY_KINDS.has(h.kind) ? [h.ticker] : [],
      ),
    ),
  ];
  const tickerCloses = new Map(
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
  /** The close a report with these positions shows, most certain first. */
  const reportDay = (
    id: number,
    at: Date,
    positions: Parameters<typeof provenDataDay>[0],
  ) =>
    feedDataDay({
      reportedAt: at,
      proven: provenDataDay(positions, tickerCloses, valuationDateFor(at)),
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
          ? reportDay(x.id, at, fromThisReport)
          : { day: reportCalendarDay(at), basis: "reported" };
      return [
        x.id,
        { ...dated, reportedAt: at, timeKnown: x.reportedAt !== null },
      ] as const;
    }),
  );

  // Every stored report of every fund, on the close it really shows (the
  // stored as_of assumes no lag).
  const reportsByTime = new Map<string, typeof history>();
  for (const h of history) {
    const key = `${h.simplefinAccountId}:${h.balanceDate?.getTime() ?? h.asOf}`;
    reportsByTime.set(key, [...(reportsByTime.get(key) ?? []), h]);
  }
  const datedHistory = [...reportsByTime.values()].flatMap((rows) => {
    const r0 = rows[0]!;
    const day = r0.balanceDate
      ? reportDay(r0.simplefinAccountId, r0.balanceDate, rows).day
      : r0.asOf;
    return rows.map((h) => ({ ...h, day }));
  });

  // Each fund's own prices: its ticker's closes, or else the institution's
  // reported value ÷ shares. Cash never moves.
  const pricesOf = new Map<number, ReadonlyMap<string, DailyClose> | null>();
  for (const id of new Set(datedHistory.map((h) => h.securityId))) {
    const rows = datedHistory.filter((h) => h.securityId === id);
    const { ticker, kind } = rows[0]!;
    if (CASH_LIKE_SECURITY_KINDS.has(kind)) continue;
    const viaTicker = ticker ? tickerCloses.get(ticker) : undefined;
    pricesOf.set(
      id,
      viaTicker ??
        (ticker
          ? null // Tiingo didn't answer: no mixing sources for one fund
          : impliedUnitPrices(
              rows.map((h) => ({
                feedId: h.simplefinAccountId,
                day: h.day,
                shares: h.shares,
                value: h.reportedMarketValue,
              })),
            )),
    );
  }

  // The close every balance is brought to: the latest every ticker fund
  // has a price for (fund prices post hours after the 4 pm close), never
  // past today's.
  const tickerLatest = [...pricesOf]
    .filter(([id]) => datedHistory.some((h) => h.securityId === id && h.ticker))
    .flatMap(([, series]) =>
      series
        ? [
            [...series.keys()]
              .filter((d) => d <= today)
              .sort()
              .at(-1),
          ]
        : [],
    )
    .filter((d): d is string => !!d);
  const target = tickerLatest.sort()[0] ?? today;

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
          sharesByDay: sharesByDay(
            datedHistory.filter(
              (r) =>
                r.simplefinAccountId === h.simplefinAccountId &&
                r.securityId === h.securityId,
            ),
          ),
          closes: pricesOf.get(h.securityId) ?? null,
          cash: CASH_LIKE_SECURITY_KINDS.has(h.kind),
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
      ? reportDay(feedId, match.reportedAt, []).day
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

  const balances = dated.map((a) =>
    currentBalance(a, snapshotDay ?? "", target),
  );

  // Daily movement: each entry's market move into each recent close, from
  // its funds' own prices — the same path as the roll above. Money moved in
  // or out is shown beside it, never in it.
  const sessions: string[] = [target];
  while (sessions.length < MOVEMENT_SESSIONS)
    sessions.push(previousTradingDay(sessions.at(-1)!));
  const sendsTransactions = new Set(context.lastTransactionDay.keys());
  const flowRows = await loadClassifiedTransactions(db, {
    since: previousTradingDay(sessions.at(-1)!),
  });
  const flows = flowRows.filter(
    (r) =>
      r.simplefinAccountId !== null &&
      sendsTransactions.has(r.simplefinAccountId) &&
      !r.pending &&
      !r.voided &&
      (r.kind === "contribution" || r.kind === "withdrawal"),
  );
  // Market accounts only: a feed reporting no holdings has nothing priced
  // to move; a part with no feed can't be told.
  const marketEntries = dated.filter(
    (a) => a.positions.length > 0 || (a.feedIds ?? []).length === 0,
  );
  // Each feed's balance at a close: its last report showing that close.
  // A report's close comes from its own holdings when they prove it, else
  // the institution's learned lag — the same dating as the holdings.
  const dayOfReport = new Map(
    datedHistory.map((h) => [
      `${h.simplefinAccountId}:${h.balanceDate?.getTime()}`,
      h.day,
    ]),
  );
  const balanceAtClose = (feedId: number, day: string, exact: boolean) => {
    const dated = (reports.get(feedId) ?? []).map((r) => ({
      balance: r.balance,
      day:
        dayOfReport.get(`${feedId}:${r.reportedAt.getTime()}`) ??
        reportDay(feedId, r.reportedAt, []).day,
    }));
    return (
      dated.filter((r) => (exact ? r.day === day : r.day <= day)).at(-1)
        ?.balance ?? null
    );
  };
  /** Money in or out of an entry into a close: its one feed's balance
   *  change less the market's move (cash held outside funds included);
   *  else what its share counts show. */
  const addedInto = (a: (typeof marketEntries)[number], day: string) => {
    const feeds = a.feedIds ?? [];
    const move = moveIntoClose(a.positions, day);
    if (feeds.length === 1 && move !== null) {
      const now = balanceAtClose(feeds[0]!, day, true);
      const before = balanceAtClose(feeds[0]!, previousTradingDay(day), false);
      if (now !== null && before !== null)
        return Math.round((now - before - move) * 100) / 100;
    }
    return addedIntoClose(a.positions, day);
  };
  const entryMoves = marketEntries.map((a) => ({
    key: a.key,
    // Who the card names when this account's move is missing.
    name:
      institutionOf((a.feedIds ?? [])[0] ?? -1) ||
      accounts.get((a.feedIds ?? [])[0] ?? -1)?.feedName ||
      a.label,
    feedIds: a.feedIds ?? [],
    moves: sessions.map((day) => ({
      day,
      move: moveIntoClose(a.positions, day),
      added: addedInto(a, day),
    })),
  }));
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
    target,
    balances,
    summary: summarizeCurrentBalances(balances),
    movement: dailyMovement({
      sessions,
      entries: entryMoves,
      // Money posted after a close counts toward the next one.
      flows: flows.map((r) => ({ day: r.posted, amount: r.amount })),
      flowsKnown: allFeeds.every(
        (x) =>
          positionsOfFeed(x.id).length === 0 || sendsTransactions.has(x.id),
      ),
      shareChanges: flowRows
        .filter(
          (r) =>
            r.simplefinAccountId !== null &&
            !r.pending &&
            !r.voided &&
            SHARE_CHANGING_KINDS.has(r.kind),
        )
        .map((r) => ({
          feedId: r.simplefinAccountId!,
          day: r.posted,
          amount: r.amount,
        })),
    }),
    entryMoves,
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
        /** Not newer than the snapshot: its figure is used. */
        behindSnapshot: behindFeed(x),
      };
    }),
  };
}

/** Shares at each close, the day's last report, oldest first. */
function sharesByDay(rows: readonly { day: string; shares: number }[]) {
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, r.shares);
  return [...byDay]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, shares]) => ({ day, shares }));
}

/** Every stored holdings report since `since`, with fund details. */
async function loadHoldingHistory(db: Db, since: string) {
  const h = schema.holdingObservations;
  const s = schema.securities;
  const rows = await db
    .select({
      simplefinAccountId: h.simplefinAccountId,
      securityId: h.securityId,
      asOf: h.asOf,
      balanceDate: h.balanceDate,
      shares: h.shares,
      value: h.reportedMarketValue,
      ticker: s.ticker,
      kind: s.kind,
    })
    .from(h)
    .innerJoin(s, eq(s.id, h.securityId))
    .where(and(isNotNull(h.simplefinAccountId), gte(h.asOf, since)))
    .orderBy(asc(h.balanceDate));
  return rows.map((r) => ({
    ...r,
    simplefinAccountId: r.simplefinAccountId!,
    shares: Number(r.shares),
    reportedMarketValue: r.value === null ? null : Number(r.value),
  }));
}
