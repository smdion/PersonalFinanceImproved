/**
 * Shared helpers for the investments router group.
 * Internal to investments/ — do not import from outside this directory.
 */
import type { TransactionSourceSplit } from "@/lib/db/schema-pg";
import { and, asc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { isHsaCategory } from "@/lib/config/account-types";
import { utcDayOf } from "@/lib/simplefin/ingest";
import {
  balanceAsOf,
  classifierRulesWith,
  effectiveTransactionKind,
  type EffectiveKind,
  type UserTransactionRule,
} from "@/lib/pure/investment-transaction-rules";
import type {
  InvestmentTransactionKind,
  KindOverrideSource,
  PortfolioTaxType,
} from "@/lib/config/enum-values";
import {
  matchInternalTransfers,
  type TransferMatch,
} from "@/lib/pure/internal-transfers";
import { loadLatestSubAccounts } from "@/server/helpers/sub-accounts";
import { countsAsFeed } from "@/lib/pure/simplefin-feeds";
import type { SimplefinTransactionRule } from "@/lib/config/simplefin-transaction-rules";

type Db = typeof import("@/lib/db").db;

export type AccountInfo = {
  id: number;
  institution: string;
  accountName: string;
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

export async function loadUserRules(db: Db): Promise<UserTransactionRule[]> {
  return db.select().from(schema.investmentTransactionRules);
}

/** SimpleFIN accounts with stored investment data, by id. */
export async function loadAccounts(db: Db): Promise<Map<number, AccountInfo>> {
  const rows = await db
    .select({
      id: schema.simplefinAccounts.id,
      orgName: schema.simplefinAccounts.orgName,
      accountName: schema.simplefinAccounts.accountName,
      accountType: schema.performanceAccounts.accountType,
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
  const subs = rows.some((r) => r.linkedSubKey)
    ? new Map((await loadLatestSubAccounts(db)).map((s) => [s.key, s]))
    : new Map();
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
  kindOverrideSource: KindOverrideSource | null;
  /** The household's split of this deposit, if set (see schema). */
  sourceSplit: TransactionSourceSplit | null;
  /** Set when this row is one side of a move between the household's own accounts. */
  transfer: TransferMatch | null;
} & EffectiveKind;

/** Stored transactions with the kind each is shown as (worked out now, never stored). */
export async function loadClassifiedTransactions(
  db: Db,
  filter: {
    simplefinAccountId?: number;
    since?: string;
    includeVoided?: boolean;
  },
  context?: {
    accounts: Map<number, AccountInfo>;
    rules: readonly SimplefinTransactionRule[];
  },
): Promise<ClassifiedTransactionRow[]> {
  const accounts = context?.accounts ?? (await loadAccounts(db));
  const balances = await loadBalanceHistory(db);
  const rules = context?.rules ?? classifierRulesWith(await loadUserRules(db));
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
      kindOverrideSource: r.kindOverrideSource,
      sourceSplit: r.sourceSplit ?? null,
      ...effectiveTransactionKind(
        institution,
        {
          amount,
          description: r.description,
          kindOverride: r.kindOverride,
          kindOverrideSource: r.kindOverrideSource,
        },
        { rules, accountBalance: balanceForRules },
      ),
      transfer: null as TransferMatch | null,
    };
  });

  // A household's own money moving between its accounts is neither added
  // nor taken out. Rows the household set by hand keep their choice.
  const matches = matchInternalTransfers(
    classified
      .filter(
        (r) =>
          !r.pending &&
          !r.voided &&
          r.source !== "override" &&
          r.source !== "locked",
      )
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
    r.needsReview = false;
    r.ruleId = null;
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

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  // eslint-disable-next-line local/no-tz-unsafe-date-string -- calendar-day arithmetic done entirely in UTC on a YYYY-MM-DD key; never compared to a local "today".
  return d.toISOString().slice(0, 10); // lint-violation-ok: UTC day arithmetic on a date key
}

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
