/**
 * Shared helpers for the investments router group.
 * Internal to investments/ — do not import from outside this directory.
 */
import { and, eq, gte, isNull } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { isHsaCategory } from "@/lib/config/account-types";
import {
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
  balance: number;
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
      lastBalance: schema.simplefinAccounts.lastBalance,
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
        balance: Number(r.lastBalance),
        isHsa: r.accountType != null && isHsaCategory(r.accountType),
      },
    ]),
  );
}

export type ClassifiedTransactionRow = {
  id: number;
  simplefinAccountId: number;
  institution: string;
  accountName: string;
  posted: string;
  /** As SimpleFIN sent it. */
  rawAmount: number;
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
      return {
        id: r.id,
        simplefinAccountId: r.simplefinAccountId,
        institution,
        accountName: account?.accountName ?? "",
        posted: r.posted,
        rawAmount: amount,
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
          { rules, accountBalance: account?.balance },
        ),
      };
    })
    .sort((a, b) => b.posted.localeCompare(a.posted) || b.id - a.id);
}
