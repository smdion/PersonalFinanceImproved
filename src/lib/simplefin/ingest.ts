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
  hasInvestedHoldings,
  planHoldingObservations,
  securityIdentity,
} from "@/lib/pure/simplefin-holdings";
import { planReconcile } from "@/lib/pure/simplefin-reconcile";
import { classifySimplefinTransaction } from "@/lib/pure/simplefin-transactions";
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

/**
 * UTC calendar day of a moment. SimpleFIN encodes institution posting dates
 * as UTC timestamps, so posted dates and the requested window are compared
 * as UTC days throughout — an internal key, never compared to a local "today".
 */
export function utcDayOf(date: Date): string {
  // eslint-disable-next-line local/no-tz-unsafe-date-string -- institution posting dates are UTC; see doc comment
  return date.toISOString().slice(0, 10); // lint-violation-ok: UTC posting-date key
}

/** UTC calendar day of a SimpleFIN `posted` timestamp (seconds). */
function postedDay(posted: number): string {
  return utcDayOf(new Date(posted * 1000));
}

function addDaysIso(day: string, n: number): string {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return utcDayOf(t);
}

/** Holding rows always come from SimpleFIN here; this guards the exactly-one rule SQLite can't enforce. */
function assertOneAccount(row: {
  simplefinAccountId: number | null;
  performanceAccountId: number | null;
}): void {
  if (
    (row.simplefinAccountId === null) ===
    (row.performanceAccountId === null)
  ) {
    throw new Error(
      "A holding observation must belong to exactly one account (SimpleFIN or tracked).",
    );
  }
}

async function ensureSecurity(
  db: Db,
  institution: string,
  holding: Parameters<typeof securityIdentity>[1],
): Promise<number> {
  const id = securityIdentity(institution, holding);
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
    assertOneAccount(values);
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
      { posted: t.posted, amount: t.amount, description: t.description },
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
  const transactedById = new Map(
    incoming.map((t) => [t.externalId, t.transacted]),
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
        gte(
          schema.investmentTransactions.posted,
          addDaysIso(windowStart, -RECONCILE_LOOKBACK_DAYS),
        ),
      ),
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
    await db.insert(schema.investmentTransactions).values({
      simplefinAccountId,
      externalId: t.externalId,
      posted: t.posted,
      transacted: transactedById.get(t.externalId) ?? null,
      amount: t.amount.toFixed(2),
      description: t.description,
      pending: t.pending,
      kindOverride: lock ? "withdrawal" : null,
      kindOverrideSource: lock ? "ingest_redacted" : null,
    });
  }
  for (const u of plan.updates) {
    await db
      .update(schema.investmentTransactions)
      .set({
        posted: u.next.posted,
        amount: u.next.amount.toFixed(2),
        description: u.next.description,
        pending: u.next.pending,
        voidedAt: null,
        updatedAt: now,
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

    // Redact card spending unless the account is linked to a non-HSA type.
    const category = linked
      ? categoryByPerfId.get(reg.linkedPerformanceAccountId!)
      : undefined;
    const redactCardSpending =
      !linked || (category !== undefined && isHsaCategory(category));
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
