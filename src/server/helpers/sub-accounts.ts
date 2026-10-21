/**
 * The household's sub-accounts as of the latest snapshot — what a SimpleFIN
 * account can link to. Sub-accounts exist only as snapshot rows (one
 * tracked account holds several: each owner's and each tax type's money;
 * DESIGN.md "Performance Accounts"), identified by snapshotAccountKey.
 */
import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { snapshotAccountKey } from "@/lib/pure/portfolio";
import type { SnapshotParts } from "@/lib/pure/holding-periods";
import { taxTypeLabel } from "@/lib/utils/colors";
import type { AccountCategory } from "@/lib/config/account-types.types";
import type { PortfolioTaxType } from "@/lib/config/enum-values";

type Db = typeof import("@/lib/db").db;

/** "Alex — Roth", "Employer Match (Traditional)" — one rule for every part label. */
function partLabel(
  r: { taxType: string; subType: string | null; ownerPersonId: number | null },
  names: ReadonlyMap<number, string>,
): string {
  const tax = taxTypeLabel(r.taxType);
  const kind = r.subType ? `${r.subType} (${tax})` : tax;
  const owner =
    r.ownerPersonId !== null ? names.get(r.ownerPersonId) : undefined;
  return owner ? `${owner} — ${kind}` : kind;
}

export type SubAccount = {
  key: string;
  performanceAccountId: number;
  institution: string;
  accountType: AccountCategory;
  ownerPersonId: number | null;
  taxType: PortfolioTaxType;
  subType: string | null;
  /** e.g. "Alex — Roth", "Employer Match (Traditional)". */
  label: string;
  /** Latest snapshot amount (rows sharing a key are summed). */
  amount: number;
};

export async function loadLatestSubAccounts(db: Db): Promise<SubAccount[]> {
  const [latest] = await db
    .select({ id: schema.portfolioSnapshots.id })
    .from(schema.portfolioSnapshots)
    .orderBy(desc(schema.portfolioSnapshots.snapshotDate))
    .limit(1);
  if (!latest) return [];
  const [rows, people] = await Promise.all([
    db
      .select({
        performanceAccountId: schema.portfolioAccounts.performanceAccountId,
        institution: schema.performanceAccounts.institution,
        accountType: schema.performanceAccounts.accountType,
        ownerPersonId: schema.portfolioAccounts.ownerPersonId,
        taxType: schema.portfolioAccounts.taxType,
        subType: schema.portfolioAccounts.subType,
        amount: schema.portfolioAccounts.amount,
      })
      .from(schema.portfolioAccounts)
      .innerJoin(
        schema.performanceAccounts,
        eq(
          schema.performanceAccounts.id,
          schema.portfolioAccounts.performanceAccountId,
        ),
      )
      .where(
        and(
          eq(schema.portfolioAccounts.snapshotId, latest.id),
          eq(schema.portfolioAccounts.isActive, true),
        ),
      ),
    db
      .select({ id: schema.people.id, name: schema.people.name })
      .from(schema.people),
  ]);
  const names = new Map(people.map((p) => [p.id, p.name]));
  const byKey = new Map<string, SubAccount>();
  for (const r of rows) {
    if (r.performanceAccountId === null) continue;
    const key = snapshotAccountKey({
      ...r,
      performanceAccountId: r.performanceAccountId,
    });
    const existing = byKey.get(key);
    if (existing) {
      existing.amount += Number(r.amount);
      continue;
    }
    byKey.set(key, {
      key,
      performanceAccountId: r.performanceAccountId,
      institution: r.institution,
      accountType: r.accountType as AccountCategory,
      ownerPersonId: r.ownerPersonId,
      taxType: r.taxType as PortfolioTaxType,
      subType: r.subType,
      label: partLabel(r, names),
      amount: Number(r.amount),
    });
  }
  return [...byKey.values()];
}

/**
 * Every part the given accounts have had in any snapshot — closed or
 * missing from the latest one included — with each snapshot's part amounts
 * (ascending by date) and each part's label from its most recent row. For
 * holding history kept per part, whose parts can predate the latest
 * snapshot (e.g. money that passed through a Traditional part years ago).
 */
export async function loadAccountPartHistory(
  db: Db,
  performanceAccountIds: readonly number[],
): Promise<
  Map<number, { snapshots: SnapshotParts[]; labels: Map<string, string> }>
> {
  const out = new Map<
    number,
    { snapshots: SnapshotParts[]; labels: Map<string, string> }
  >();
  if (performanceAccountIds.length === 0) return out;
  const pa = schema.portfolioAccounts;
  const [rows, people] = await Promise.all([
    db
      .select({
        performanceAccountId: pa.performanceAccountId,
        ownerPersonId: pa.ownerPersonId,
        taxType: pa.taxType,
        subType: pa.subType,
        amount: pa.amount,
        date: schema.portfolioSnapshots.snapshotDate,
      })
      .from(pa)
      .innerJoin(
        schema.portfolioSnapshots,
        eq(schema.portfolioSnapshots.id, pa.snapshotId),
      )
      .where(inArray(pa.performanceAccountId, [...performanceAccountIds]))
      .orderBy(asc(schema.portfolioSnapshots.snapshotDate)),
    db
      .select({ id: schema.people.id, name: schema.people.name })
      .from(schema.people),
  ]);
  const names = new Map(people.map((p) => [p.id, p.name]));
  for (const r of rows) {
    if (r.performanceAccountId === null) continue;
    const id = r.performanceAccountId;
    const entry = out.get(id) ?? {
      snapshots: [] as SnapshotParts[],
      labels: new Map<string, string>(),
    };
    out.set(id, entry);
    const key = snapshotAccountKey({ ...r, performanceAccountId: id });
    let snap = entry.snapshots[entry.snapshots.length - 1];
    if (!snap || snap.date !== r.date) {
      snap = { date: r.date, amounts: new Map() };
      entry.snapshots.push(snap);
    }
    const amounts = snap.amounts as Map<string, number>;
    amounts.set(key, (amounts.get(key) ?? 0) + Number(r.amount));
    // Ascending, so the last row seen names the part.
    entry.labels.set(key, partLabel(r, names));
  }
  return out;
}
