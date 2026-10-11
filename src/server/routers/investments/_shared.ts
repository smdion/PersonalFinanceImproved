/**
 * Shared helpers for the investments router group.
 * Internal to investments/ — do not import from outside this directory.
 */
import { and, asc, eq, gte, isNull } from "drizzle-orm";
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
} from "@/lib/config/enum-values";
import type { SimplefinTransactionRule } from "@/lib/config/simplefin-transaction-rules";

type Db = typeof import("@/lib/db").db;

export type AccountInfo = {
  id: number;
  institution: string;
  accountName: string;
  /** Linked to an HSA-type tracked account. */
  isHsa: boolean;
};

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
    })
    .from(schema.simplefinAccounts)
    .leftJoin(
      schema.performanceAccounts,
      eq(
        schema.performanceAccounts.id,
        schema.simplefinAccounts.linkedPerformanceAccountId,
      ),
    );
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        institution: r.orgName,
        accountName: r.accountName,
        isHsa: r.accountType != null && isHsaCategory(r.accountType),
      },
    ]),
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
  const rows = await db
    .select()
    .from(t)
    .where(
      and(
        filter.simplefinAccountId !== undefined
          ? eq(t.simplefinAccountId, filter.simplefinAccountId)
          : undefined,
        filter.since !== undefined ? gte(t.posted, filter.since) : undefined,
        filter.includeVoided ? undefined : isNull(t.voidedAt),
      ),
    );
  return rows
    .map((r) => {
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
      };
    })
    .sort((a, b) => b.posted.localeCompare(a.posted) || b.id - a.id);
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
