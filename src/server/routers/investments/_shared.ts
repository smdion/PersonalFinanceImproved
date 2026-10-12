/**
 * Shared helpers for the investments router group.
 * Internal to investments/ — do not import from outside this directory.
 */
import { accountDisplayName } from "@/lib/utils/format";
import { and, asc, desc, eq, gte, isNotNull, isNull, max } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { isHsaCategory } from "@/lib/config/account-types";
import { addDays, utcDayOf } from "@/lib/utils/date";
import {
  balanceAsOf,
  effectiveTransactionKind,
  type EffectiveKind,
} from "@/lib/pure/transaction-kind";
import type {
  InvestmentTransactionKind,
  PortfolioTaxType,
} from "@/lib/config/enum-values";
import {
  matchInternalTransfers,
  recordedMoveDeposits,
  type TransferMatch,
} from "@/lib/pure/internal-transfers";
import {
  loadLatestSubAccounts,
  type SubAccount,
} from "@/server/helpers/sub-accounts";
import { toNumber } from "@/server/helpers/transforms";
import type { FeedAccount } from "@/lib/pure/flow-suggestions";
import {
  suggestSnapshotAmounts,
  type UnplacedFeed,
} from "@/lib/pure/snapshot-suggestions";
import { countsAsFeed } from "@/lib/pure/simplefin-feeds";

type Db = typeof import("@/lib/db").db;

export type AccountInfo = {
  id: number;
  institution: string;
  accountName: string;
  /** The institution's own name for it (institution + account name). */
  feedName: string;
  /**
   * What to call it: the tracked account's name (accountDisplayName), plus
   * the part when linked to one; the institution's own name only when it
   * feeds no tracked account.
   */
  label: string;
  /** Linked to an HSA-type tracked account. */
  isHsa: boolean;
  performanceAccountId: number | null;
  /** From a sub-account link (null for a whole-account link or a joint sub-account). */
  ownerPersonId: number | null;
  taxType: PortfolioTaxType | null;
};

/**
 * SQL form of countsAsFeed (lib/pure/simplefin-feeds.ts): linked to a
 * tracked account and included. Unchecked accounts are ignored everywhere.
 */
export const countedFeed = and(
  isNotNull(schema.simplefinAccounts.linkedPerformanceAccountId),
  eq(schema.simplefinAccounts.isIncluded, true),
);

/** A counted SimpleFIN feed: its link, balance, and the day the balance is from. */
export type ContextFeed = FeedAccount & { balanceDay: string | null };

/** What every investments view starts from — loaded once, in one place. */
export type FeedContext = {
  feeds: ContextFeed[];
  /** The latest snapshot's sub-accounts. */
  subs: SubAccount[];
  snapshotDate: string | null;
  /** Each feed's latest posted transaction day (absent: never sent one). */
  lastTransactionDay: Map<number, string>;
  /** Feeds whose money no part of the latest snapshot holds. */
  unplaced: UnplacedFeed[];
};

export async function loadFeedContext(db: Db): Promise<FeedContext> {
  const f = schema.simplefinAccounts;
  const t = schema.investmentTransactions;
  const [rows, subs, latest, last] = await Promise.all([
    db
      .select({
        id: f.id,
        performanceAccountId: f.linkedPerformanceAccountId,
        subKey: f.linkedSubKey,
        balance: f.lastBalance,
        balanceDate: f.lastBalanceDate,
      })
      .from(f)
      .where(countedFeed),
    loadLatestSubAccounts(db),
    db
      .select({ date: schema.portfolioSnapshots.snapshotDate })
      .from(schema.portfolioSnapshots)
      .orderBy(desc(schema.portfolioSnapshots.snapshotDate))
      .limit(1),
    db
      .select({ id: t.simplefinAccountId, day: max(t.posted) })
      .from(t)
      .groupBy(t.simplefinAccountId),
  ]);
  const subByKey = new Map(subs.map((s) => [s.key, s]));
  const feeds: ContextFeed[] = rows.map((r) => ({
    id: r.id,
    performanceAccountId: r.performanceAccountId!,
    subKey: r.subKey,
    ownerPersonId: r.subKey
      ? (subByKey.get(r.subKey)?.ownerPersonId ?? null)
      : null,
    balance: toNumber(r.balance),
    balanceDay: r.balanceDate ? utcDayOf(r.balanceDate) : null,
  }));
  const { unplaced } = suggestSnapshotAmounts(
    subs,
    feeds.map((x) => ({ ...x, balanceDate: x.balanceDay })),
  );
  return {
    feeds,
    subs,
    snapshotDate: latest[0]?.date ?? null,
    lastTransactionDay: new Map(
      last.filter((l) => l.day !== null).map((l) => [l.id, l.day!]),
    ),
    unplaced,
  };
}

/**
 * "<tracked account>|<year>" → the tracked account Performance records money
 * rolling out of, for accounts whose row that year records money rolling in
 * (positive rollovers) while another's records it rolling out.
 */
async function recordedMovesIn(db: Db): Promise<Map<string, string>> {
  const rows = await db
    .select({
      performanceAccountId: schema.accountPerformance.performanceAccountId,
      year: schema.accountPerformance.year,
      rollovers: schema.accountPerformance.rollovers,
      institution: schema.performanceAccounts.institution,
      accountLabel: schema.performanceAccounts.accountLabel,
      displayName: schema.performanceAccounts.displayName,
      accountType: schema.performanceAccounts.accountType,
    })
    .from(schema.accountPerformance)
    .innerJoin(
      schema.performanceAccounts,
      eq(
        schema.performanceAccounts.id,
        schema.accountPerformance.performanceAccountId,
      ),
    );
  const out = new Map<string, string>();
  for (const into of rows) {
    if (Number(into.rollovers) <= 0) continue;
    const from = rows.find(
      (r) =>
        r.year === into.year &&
        r.performanceAccountId !== into.performanceAccountId &&
        Number(r.rollovers) < 0,
    );
    if (from)
      out.set(
        `${into.performanceAccountId}|${into.year}`,
        accountDisplayName(from),
      );
  }
  return out;
}

/** SimpleFIN accounts with stored investment data, by id. */
export async function loadAccounts(db: Db): Promise<Map<number, AccountInfo>> {
  const rows = await db
    .select({
      id: schema.simplefinAccounts.id,
      orgName: schema.simplefinAccounts.orgName,
      accountName: schema.simplefinAccounts.accountName,
      accountType: schema.performanceAccounts.accountType,
      perf: {
        accountType: schema.performanceAccounts.accountType,
        subType: schema.performanceAccounts.subType,
        label: schema.performanceAccounts.label,
        institution: schema.performanceAccounts.institution,
        displayName: schema.performanceAccounts.displayName,
        accountLabel: schema.performanceAccounts.accountLabel,
        ownershipType: schema.performanceAccounts.ownershipType,
        ownerPersonId: schema.performanceAccounts.ownerPersonId,
      },
      performanceAccountId: schema.simplefinAccounts.linkedPerformanceAccountId,
      linkedSubKey: schema.simplefinAccounts.linkedSubKey,
      isIncluded: schema.simplefinAccounts.isIncluded,
    })
    .from(schema.simplefinAccounts)
    .leftJoin(
      schema.performanceAccounts,
      eq(
        schema.performanceAccounts.id,
        schema.simplefinAccounts.linkedPerformanceAccountId,
      ),
    );
  const [subs, people] = await Promise.all([
    rows.some((r) => r.linkedSubKey)
      ? loadLatestSubAccounts(db).then((l) => new Map(l.map((s) => [s.key, s])))
      : new Map(),
    db
      .select({ id: schema.people.id, name: schema.people.name })
      .from(schema.people),
  ]);
  const names = new Map(people.map((p) => [p.id, p.name]));
  return new Map(
    rows.map((r) => {
      // An unchecked account keeps its link (HSA redaction still follows
      // it) but feeds no tracked account — see countsAsFeed.
      const feeds = countsAsFeed({
        linkedPerformanceAccountId: r.performanceAccountId,
        isIncluded: r.isIncluded,
      });
      const sub =
        feeds && r.linkedSubKey ? subs.get(r.linkedSubKey) : undefined;
      return [
        r.id,
        {
          id: r.id,
          institution: r.orgName,
          accountName: r.accountName,
          feedName: `${r.orgName} ${r.accountName}`.trim(),
          label:
            feeds && r.perf?.accountLabel
              ? `${accountDisplayName(
                  r.perf,
                  r.perf.ownerPersonId != null
                    ? names.get(r.perf.ownerPersonId)
                    : undefined,
                )}${sub ? ` · ${sub.label}` : ""}`
              : `${r.orgName} ${r.accountName}`.trim(),
          isHsa: r.accountType != null && isHsaCategory(r.accountType),
          performanceAccountId: feeds ? r.performanceAccountId : null,
          ownerPersonId: sub?.ownerPersonId ?? null,
          taxType: sub?.taxType ?? null,
        },
      ];
    }),
  );
}

export type BalanceHistory = Map<number, { day: string; balance: number }[]>;

/** Each account's stored balances by UTC day, ascending — input to {@link balanceAsOf}. */
export async function loadBalanceHistory(db: Db): Promise<BalanceHistory> {
  const rows = await db
    .select()
    .from(schema.simplefinAccountBalances)
    .orderBy(asc(schema.simplefinAccountBalances.balanceDate));
  const history: BalanceHistory = new Map();
  for (const r of rows) {
    const list = history.get(r.simplefinAccountId) ?? [];
    list.push({ day: utcDayOf(r.balanceDate), balance: Number(r.balance) });
    history.set(r.simplefinAccountId, list);
  }
  return history;
}

export type ClassifiedTransactionRow = {
  id: number;
  simplefinAccountId: number;
  institution: string;
  accountName: string;
  posted: string;
  /** As SimpleFIN sent it. */
  rawAmount: number;
  /** Balance used to judge "small" for this row (never shown). */
  balanceForRules: number | undefined;
  description: string;
  pending: boolean;
  voided: boolean;
  kindOverride: InvestmentTransactionKind | null;
  /** Set when this row is one side of a move between the household's own accounts. */
  transfer: TransferMatch | null;
  /** Probably money already recorded (in Performance) as moved in from this account; fills leave it out. */
  recordedMoveFrom: string | null;
} & EffectiveKind;

/** Stored transactions with the kind each is shown as (worked out now, never stored). */
export async function loadClassifiedTransactions(
  db: Db,
  filter: {
    simplefinAccountId?: number;
    since?: string;
    includeVoided?: boolean;
  },
): Promise<ClassifiedTransactionRow[]> {
  const [accounts, balances] = await Promise.all([
    loadAccounts(db),
    loadBalanceHistory(db),
  ]);
  const t = schema.investmentTransactions;
  // Transfers pair rows across accounts and a few days, so read every
  // account and a margin before `since`; the filter applies afterwards.
  const readFrom =
    filter.since !== undefined
      ? addDays(filter.since, -TRANSFER_MARGIN_DAYS)
      : undefined;
  const rows = await db
    .select()
    .from(t)
    .where(
      and(
        readFrom !== undefined ? gte(t.posted, readFrom) : undefined,
        filter.includeVoided ? undefined : isNull(t.voidedAt),
      ),
    );
  const classified = rows.map((r) => {
    const account = accounts.get(r.simplefinAccountId);
    const institution = account?.institution ?? "";
    const amount = Number(r.amount);
    const balanceForRules = balanceAsOf(
      balances.get(r.simplefinAccountId) ?? [],
      r.posted,
    );
    return {
      id: r.id,
      simplefinAccountId: r.simplefinAccountId,
      institution,
      accountName: account?.accountName ?? "",
      posted: r.posted,
      rawAmount: amount,
      balanceForRules,
      description: r.description,
      pending: r.pending,
      voided: r.voidedAt !== null,
      kindOverride: r.kindOverride,
      ...effectiveTransactionKind(
        institution,
        {
          amount,
          description: r.description,
          kindOverride: r.kindOverride,
        },
        { accountBalance: balanceForRules },
      ),
      transfer: null as TransferMatch | null,
      recordedMoveFrom: null as string | null,
    };
  });

  // A household's own money moving between its accounts is neither added
  // nor taken out. Rows ingest locked keep their kind.
  const matches = matchInternalTransfers(
    classified
      .filter((r) => !r.pending && !r.voided && r.source !== "locked")
      .map((r) => {
        const a = accounts.get(r.simplefinAccountId);
        return {
          id: r.id,
          simplefinAccountId: r.simplefinAccountId,
          performanceAccountId: a?.performanceAccountId ?? null,
          ownerPersonId: a?.ownerPersonId ?? null,
          taxType: a?.taxType ?? null,
          posted: r.posted,
          amount: r.amount,
          kind: r.kind,
        };
      }),
  );
  for (const r of classified) {
    const m = matches.get(r.id);
    if (!m) continue;
    r.transfer = m;
    r.kind = "transfer";
    r.source = "transfer_match";
    r.uncertain = false;
    r.ruleId = null;
  }

  // Deposits that are probably money already recorded as moved in.
  const recorded = await recordedMovesIn(db);
  const likely = recordedMoveDeposits(
    classified
      .filter((r) => !r.pending && !r.voided)
      .map((r) => ({
        id: r.id,
        performanceAccountId:
          accounts.get(r.simplefinAccountId)?.performanceAccountId ?? null,
        posted: r.posted,
        amount: r.amount,
        kind: r.kind,
        settled: r.transfer !== null || r.source === "locked",
      })),
    (performanceAccountId, year) =>
      recorded.get(`${performanceAccountId}|${year}`) ?? null,
  );
  for (const r of classified) {
    const from = likely.get(r.id);
    if (from) r.recordedMoveFrom = from;
  }

  return classified
    .filter(
      (r) =>
        (filter.since === undefined || r.posted >= filter.since) &&
        (filter.simplefinAccountId === undefined ||
          r.simplefinAccountId === filter.simplefinAccountId),
    )
    .sort((a, b) => b.posted.localeCompare(a.posted) || b.id - a.id);
}

const TRANSFER_MARGIN_DAYS = 7;

/**
 * Each SimpleFIN account's holdings on the latest date it reported them,
 * with fund details. Funds sold since (latest row 0 shares) are left out.
 */
export async function loadLatestHoldings(db: Db) {
  const h = schema.holdingObservations;
  const s = schema.securities;
  const rows = await db
    .select({
      simplefinAccountId: h.simplefinAccountId,
      securityId: h.securityId,
      asOf: h.asOf,
      shares: h.shares,
      reportedMarketValue: h.reportedMarketValue,
      avgCostPerShare: h.avgCostPerShare,
      ticker: s.ticker,
      sourceSymbol: s.sourceSymbol,
      name: s.name,
      kind: s.kind,
    })
    .from(h)
    .innerJoin(s, eq(s.id, h.securityId));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (r.simplefinAccountId === null) continue; // manual rows come later
    const key = `${r.simplefinAccountId}:${r.securityId}`;
    const prev = latest.get(key);
    if (!prev || r.asOf > prev.asOf) latest.set(key, r);
  }
  return [...latest.values()]
    .filter((r) => Number(r.shares) !== 0)
    .map((r) => ({
      ...r,
      simplefinAccountId: r.simplefinAccountId!,
      shares: Number(r.shares),
      reportedMarketValue:
        r.reportedMarketValue === null ? null : Number(r.reportedMarketValue),
      avgCostPerShare:
        r.avgCostPerShare === null ? null : Number(r.avgCostPerShare),
    }));
}
