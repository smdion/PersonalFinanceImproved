/**
 * The household's sub-accounts as of the latest snapshot — what a SimpleFIN
 * account can link to. Sub-accounts exist only as snapshot rows (one
 * tracked account holds several: each owner's and each tax type's money;
 * DESIGN.md "Performance Accounts"), identified by snapshotAccountKey.
 */
import "server-only";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { snapshotAccountKey } from "@/lib/pure/portfolio";
import { taxTypeLabel } from "@/lib/utils/colors";
import type { AccountCategory } from "@/lib/config/account-types.types";
import type { PortfolioTaxType } from "@/lib/config/enum-values";

type Db = typeof import("@/lib/db").db;

export type SubAccount = {
  key: string;
  performanceAccountId: number;
  institution: string;
  accountType: AccountCategory;
  ownerPersonId: number | null;
  taxType: PortfolioTaxType;
  subType: string | null;
  /** e.g. "Sean — Roth", "Employer Match (Traditional)". */
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
    const tax = taxTypeLabel(r.taxType);
    const kind = r.subType ? `${r.subType} (${tax})` : tax;
    const owner =
      r.ownerPersonId !== null ? names.get(r.ownerPersonId) : undefined;
    byKey.set(key, {
      key,
      performanceAccountId: r.performanceAccountId,
      institution: r.institution,
      accountType: r.accountType as AccountCategory,
      ownerPersonId: r.ownerPersonId,
      taxType: r.taxType as PortfolioTaxType,
      subType: r.subType,
      label: owner ? `${owner} — ${kind}` : kind,
      amount: Number(r.amount),
    });
  }
  return [...byKey.values()];
}
