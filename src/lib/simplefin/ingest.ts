// Store what SimpleFIN only keeps for ~90 days: per-account balances,
// holdings and transactions. Called from runSimplefinSync (the one sync path
// shared by the daily cron and "Sync Now") after the balance snapshot.
//
// Only investment accounts are stored — accounts linked to a tracked
// (performance) account, or reporting invested holdings. Checking and
// credit-card data in the same response is never written.
//
// Transactions are stored as sent; their kind is computed on read. HSA card
// spending is the one exception: the merchant name is health data, so it is
// replaced by "Medical withdrawal" here and the kind is locked.
import "server-only";
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { SimplefinAccount } from "./client";
import {
  assertHoldingHasOneAccount,
  hasInvestedHoldings,
  planHoldingObservations,
  securityIdentity,
} from "@/lib/pure/simplefin-holdings";
import { planReconcile } from "@/lib/pure/simplefin-reconcile";
import { classifySimplefinTransaction } from "@/lib/pure/simplefin-transactions";
import { addDays, utcDayOf } from "@/lib/utils/date";
import { valuationDateFor } from "@/lib/pure/market-calendar";
import { isHsaCategory } from "@/lib/config/account-types";

type Db = typeof import("@/lib/db").db;

export const REDACTED_MEDICAL_DESCRIPTION = "Medical withdrawal";
/** Look back this far before the requested window when loading stored rows (pending matching). */
const RECONCILE_LOOKBACK_DAYS = 5;

export type IngestSummary = {
  accountsStored: number;
  holdingsRecorded: number;
  transactionsAdded: number;
  transactionsUpdated: number;
  transactionsVoided: number;
  warnings: string[];
};

/** UTC calendar day of a SimpleFIN `posted` timestamp (seconds). */
function postedDay(posted: number): string {
  return utcDayOf(new Date(posted * 1000));
}

async function ensureSecurity(
  db: Db,
  institution: string,
  holding: Parameters<typeof securityIdentity>[1],
): Promise<number> {
  const id = securityIdentity(institution, holding);
  // A validated ticker (confirmed by SEC) is one fund wherever it's held.
  const symbol = id.sourceSymbol?.toUpperCase();
  if (symbol) {
    const [byTicker] = await db
      .select({ id: schema.securities.id })
      .from(schema.securities)
      .where(eq(schema.securities.ticker, symbol))
      .limit(1);
    if (byTicker) return byTicker.id;
  }
  const existing = await db
    .select({ id: schema.securities.id })
    .from(schema.securities)
    .where(
      and(
        isNull(schema.securities.ticker),
        eq(schema.securities.institution, id.institution),
        eq(schema.securities.sourceDescription, id.sourceDescription),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0].id;
  // Stored before the institution name was known (a SimpleFIN v2 response
  // read without its connection names): adopt it rather than duplicate the
  // fund and split its history.
  if (id.institution) {
    const [unnamed] = await db
      .select({ id: schema.securities.id })
      .from(schema.securities)
      .where(
        and(
          isNull(schema.securities.ticker),
          eq(schema.securities.institution, ""),
          eq(schema.securities.sourceDescription, id.sourceDescription),
        ),
      )
      .limit(1);
    if (unnamed) {
      await db
        .update(schema.securities)
        .set({ institution: id.institution })
        .where(eq(schema.securities.id, unnamed.id));
      return unnamed.id;
    }
  }
  const inserted = await db
    .insert(schema.securities)
    .values({
      sourceSymbol: id.sourceSymbol,
      name: id.name,
      kind: id.kind,
      institution: id.institution,
      sourceDescription: id.sourceDescription,
    })
    .returning({ id: schema.securities.id });
  return inserted[0]!.id;
}

async function ingestHoldings(
  db: Db,
  simplefinAccountId: number,
  account: SimplefinAccount,
  asOf: string,
  label: string,
  summary: IngestSummary,
): Promise<void> {
  // Most recent observation per security before this valuation date.
  const prior = await db
    .select({
      securityId: schema.holdingObservations.securityId,
      shares: schema.holdingObservations.shares,
      asOf: schema.holdingObservations.asOf,
      institution: schema.securities.institution,
      sourceDescription: schema.securities.sourceDescription,
    })
    .from(schema.holdingObservations)
    .innerJoin(
      schema.securities,
      eq(schema.securities.id, schema.holdingObservations.securityId),
    )
    .where(
      and(
        eq(schema.holdingObservations.simplefinAccountId, simplefinAccountId),
        lt(schema.holdingObservations.asOf, asOf),
      ),
    )
    .orderBy(desc(schema.holdingObservations.asOf));
  const previouslyHeld = new Map<string, number>();
  for (const p of prior) {
    const key = `${p.institution ?? ""}\u0000${p.sourceDescription ?? ""}`;
    if (!previouslyHeld.has(key)) previouslyHeld.set(key, Number(p.shares));
  }

  const plan = planHoldingObservations(
    account.orgName,
    account.holdings,
    previouslyHeld,
  );
  if (plan.status === "unknown") {
    summary.warnings.push(
      `${label}: no holdings reported this sync — kept the last known holdings.`,
    );
    return;
  }

  const holdingByKey = new Map(
    (account.holdings ?? []).map((h) => [
      securityIdentity(account.orgName, h).key,
      h,
    ]),
  );
  for (const row of plan.rows) {
    const source = holdingByKey.get(row.key);
    const [institution, description] = row.key.split("\u0000") as [
      string,
      string,
    ];
    const securityId = await ensureSecurity(
      db,
      institution,
      source ?? {
        symbol: "",
        description,
        shares: 0,
        marketValue: null,
        costBasisPerShare: null,
      },
    );
    const values = {
      simplefinAccountId,
      performanceAccountId: null,
      securityId,
      balanceDate: account.balanceDate,
      asOf,
      shares: row.shares.toFixed(8),
      reportedMarketValue:
        row.marketValue === null ? null : row.marketValue.toFixed(2),
      avgCostPerShare:
        row.costBasisPerShare === null
          ? null
          : row.costBasisPerShare.toFixed(8),
      source: "simplefin" as const,
    };
    assertHoldingHasOneAccount(values);
    await db
      .insert(schema.holdingObservations)
      .values(values)
      .onConflictDoUpdate({
        target: [
          schema.holdingObservations.simplefinAccountId,
          schema.holdingObservations.securityId,
          schema.holdingObservations.asOf,
        ],
        targetWhere: sql`${schema.holdingObservations.simplefinAccountId} IS NOT NULL`,
        set: {
          balanceDate: values.balanceDate,
          shares: values.shares,
          reportedMarketValue: values.reportedMarketValue,
          avgCostPerShare: values.avgCostPerShare,
        },
      });
    summary.holdingsRecorded++;
  }
}

async function ingestTransactions(
  db: Db,
  simplefinAccountId: number,
  account: SimplefinAccount,
  redactCardSpending: boolean,
  windowStart: string,
  accountHasError: boolean,
  summary: IngestSummary,
  label: string,
): Promise<void> {
  const redacted = new Set<string>();
  const incoming = (account.transactions ?? []).map((t) => {
    const c = classifySimplefinTransaction(
      account.orgName,
      { amount: t.amount, description: t.description },
      { accountBalance: account.balance },
    );
    const redact = redactCardSpending && c.redactDescription;
    if (redact) redacted.add(t.id);
    return {
      externalId: t.id,
      posted: postedDay(t.posted),
      transacted: t.transactedAt !== null ? postedDay(t.transactedAt) : null,
      amount: t.amount,
      description: redact ? REDACTED_MEDICAL_DESCRIPTION : t.description,
      pending: t.pending,
    };
  });

  // Cover every incoming row as well as the window: a response can include
  // rows older than the requested start (providers don't always honour it).
  const earliest = incoming.reduce(
    (min, t) => (t.posted < min ? t.posted : min),
    addDays(windowStart, -RECONCILE_LOOKBACK_DAYS),
  );
  const storedRows = await db
    .select()
    .from(schema.investmentTransactions)
    .where(
      and(
        eq(
          schema.investmentTransactions.simplefinAccountId,
          simplefinAccountId,
        ),
        gte(schema.investmentTransactions.posted, earliest),
      ),
    );
  // A row redacted once stays redacted, whatever text the provider sends
  // later (pending → posted, a format change): the merchant name must never
  // overwrite "Medical withdrawal".
  const lockedIds = new Set(
    storedRows.filter((r) => r.kindOverride !== null).map((r) => r.externalId),
  );
  for (const t of incoming) {
    if (lockedIds.has(t.externalId)) {
      t.description = REDACTED_MEDICAL_DESCRIPTION;
      redacted.add(t.externalId);
    }
  }
  const transactedById = new Map(
    incoming.map((t) => [t.externalId, t.transacted]),
  );

  const plan = planReconcile({
    incoming,
    stored: storedRows.map((r) => ({
      id: r.id,
      externalId: r.externalId,
      posted: r.posted,
      amount: Number(r.amount),
      description: r.description,
      pending: r.pending,
      voided: r.voidedAt !== null,
    })),
    windowStart,
    accountHasError,
  });

  const now = new Date();
  for (const t of plan.inserts) {
    const lock = redacted.has(t.externalId);
    await db
      .insert(schema.investmentTransactions)
      .values({
        simplefinAccountId,
        externalId: t.externalId,
        posted: t.posted,
        transacted: transactedById.get(t.externalId) ?? null,
        amount: t.amount.toFixed(2),
        description: t.description,
        pending: t.pending,
        kindOverride: lock ? "withdrawal" : null,
      })
      // Safety net: a row that already exists is never an error worth
      // aborting the rest of the account over.
      .onConflictDoNothing();
  }
  for (const u of plan.updates) {
    // A row that becomes card spending on update gets the same lock as an
    // insert, so it can't be reclassified into showing up elsewhere.
    const lock = redacted.has(u.next.externalId);
    await db
      .update(schema.investmentTransactions)
      .set({
        posted: u.next.posted,
        amount: u.next.amount.toFixed(2),
        description: u.next.description,
        pending: u.next.pending,
        voidedAt: null,
        updatedAt: now,
        ...(lock ? { kindOverride: "withdrawal" as const } : {}),
      })
      .where(eq(schema.investmentTransactions.id, u.id));
  }
  if (plan.voids.length > 0) {
    await db
      .update(schema.investmentTransactions)
      .set({ voidedAt: now, updatedAt: now })
      .where(inArray(schema.investmentTransactions.id, plan.voids));
  }
  summary.transactionsAdded += plan.inserts.length;
  summary.transactionsUpdated += plan.updates.length;
  summary.transactionsVoided += plan.voids.length;
  summary.warnings.push(...plan.warnings.map((w) => `${label}: ${w}`));
}

/**
 * Store balances, holdings and transactions for the investment accounts in
 * one SimpleFIN response. `registry` maps SimpleFIN external account ids to
 * their simplefin_accounts rows (already upserted by the caller).
 */
/**
 * Card spending is redacted unless the account is linked to a non-HSA type:
 * an unlinked account might be an HSA, so it is treated as one.
 */
function redactsCardSpending(
  linked: boolean,
  accountType: string | undefined,
): boolean {
  return !linked || (accountType !== undefined && isHsaCategory(accountType));
}

/** Whether a stored SimpleFIN account's card spending is redacted (see {@link redactsCardSpending}). */
async function accountRedactsCardSpending(
  db: Db,
  simplefinAccountId: number,
): Promise<boolean> {
  const [row] = await db
    .select({
      linkedId: schema.simplefinAccounts.linkedPerformanceAccountId,
      accountType: schema.performanceAccounts.accountType,
    })
    .from(schema.simplefinAccounts)
    .leftJoin(
      schema.performanceAccounts,
      eq(
        schema.performanceAccounts.id,
        schema.simplefinAccounts.linkedPerformanceAccountId,
      ),
    )
    .where(eq(schema.simplefinAccounts.id, simplefinAccountId));
  if (!row) return true;
  return redactsCardSpending(
    row.linkedId !== null,
    row.accountType ?? undefined,
  );
}

/** Replace a stored row's description with "Medical withdrawal" and lock its kind. */
async function lockAsMedicalWithdrawal(
  db: Db,
  transactionIds: readonly number[],
): Promise<void> {
  if (transactionIds.length === 0) return;
  await db
    .update(schema.investmentTransactions)
    .set({
      description: REDACTED_MEDICAL_DESCRIPTION,
      kindOverride: "withdrawal",
      updatedAt: new Date(),
    })
    .where(inArray(schema.investmentTransactions.id, [...transactionIds]));
}

/**
 * Redact card spending already stored for an account — for when an account
 * is (re)linked to an HSA after rows were kept with merchant names. Returns
 * the number of rows redacted.
 */
export async function redactStoredCardSpending(
  db: Db,
  simplefinAccountId: number,
): Promise<number> {
  if (!(await accountRedactsCardSpending(db, simplefinAccountId))) return 0;
  const [account] = await db
    .select({ orgName: schema.simplefinAccounts.orgName })
    .from(schema.simplefinAccounts)
    .where(eq(schema.simplefinAccounts.id, simplefinAccountId));
  if (!account) return 0;
  const rows = await db
    .select()
    .from(schema.investmentTransactions)
    .where(
      eq(schema.investmentTransactions.simplefinAccountId, simplefinAccountId),
    );
  const ids = rows
    .filter(
      (r) =>
        r.kindOverride === null &&
        classifySimplefinTransaction(account.orgName, {
          amount: Number(r.amount),
          description: r.description,
        }).redactDescription,
    )
    .map((r) => r.id);
  await lockAsMedicalWithdrawal(db, ids);
  return ids.length;
}

export async function ingestInvestmentData(
  db: Db,
  args: {
    accounts: readonly SimplefinAccount[];
    registry: ReadonlyMap<
      string,
      { id: number; linkedPerformanceAccountId: number | null }
    >;
    /** "YYYY-MM-DD" — the start-date requested from SimpleFIN. */
    windowStart: string;
    accountIdsWithErrors: ReadonlySet<string>;
    now?: Date;
  },
): Promise<IngestSummary> {
  const summary: IngestSummary = {
    accountsStored: 0,
    holdingsRecorded: 0,
    transactionsAdded: 0,
    transactionsUpdated: 0,
    transactionsVoided: 0,
    warnings: [],
  };
  const linkedIds = [...args.registry.values()]
    .map((r) => r.linkedPerformanceAccountId)
    .filter((id): id is number => id !== null);
  const categoryByPerfId = new Map(
    linkedIds.length === 0
      ? []
      : (
          await db
            .select({
              id: schema.performanceAccounts.id,
              accountType: schema.performanceAccounts.accountType,
            })
            .from(schema.performanceAccounts)
            .where(inArray(schema.performanceAccounts.id, linkedIds))
        ).map((r) => [r.id, r.accountType]),
  );

  for (const account of args.accounts) {
    const reg = args.registry.get(account.id);
    if (!reg) continue;
    const linked = reg.linkedPerformanceAccountId !== null;
    if (!linked && !hasInvestedHoldings(account.holdings)) continue;
    summary.accountsStored++;
    const label = `${account.orgName} ${account.name}`.trim();

    if (account.balanceDate) {
      await db
        .insert(schema.simplefinAccountBalances)
        .values({
          simplefinAccountId: reg.id,
          balanceDate: account.balanceDate,
          balance: account.balance.toFixed(2),
        })
        .onConflictDoUpdate({
          target: [
            schema.simplefinAccountBalances.simplefinAccountId,
            schema.simplefinAccountBalances.balanceDate,
          ],
          set: { balance: account.balance.toFixed(2) },
        });
    }

    const asOf = valuationDateFor(
      account.balanceDate ?? args.now ?? new Date(),
    );
    await ingestHoldings(db, reg.id, account, asOf, label, summary);

    const redactCardSpending = redactsCardSpending(
      linked,
      linked
        ? categoryByPerfId.get(reg.linkedPerformanceAccountId!)
        : undefined,
    );
    await ingestTransactions(
      db,
      reg.id,
      account,
      redactCardSpending,
      args.windowStart,
      args.accountIdsWithErrors.has(account.id),
      summary,
      label,
    );
  }
  return summary;
}
