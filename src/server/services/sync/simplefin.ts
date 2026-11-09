/** SimpleFIN link context: sub-accounts by key and link suggestions for the
 *  household's SimpleFIN accounts, read by the simplefin router. */
import * as schema from "@/lib/db/schema";
import { loadLatestSubAccounts } from "@/server/data/sub-accounts";
import { suggestLinks } from "@/lib/pure/sync/simplefin-link-suggestions";
import { recogniseAccountKind } from "@/lib/config/simplefin-account-kinds";
import { taxTypeLabel } from "@/lib/config/display-labels";
import { accountDisplayName } from "@/lib/utils/format";
import type { Db } from "@/lib/db";
import { asc } from "drizzle-orm";
import { countsAsFeed, isUnclaimedDebt } from "@/lib/pure/sync/simplefin-feeds";
import { getLatestSnapshot } from "@/server/data/snapshots";
import { roundToCents } from "@/lib/utils/math";
import {
  isRetirementParent,
  isPortfolioParent,
} from "@/lib/config/account-types";
import type {
  ParentCategory,
  AccountCategory,
} from "@/lib/config/account-types";
import type { PortfolioTaxType } from "@/lib/config/enum-values";

type LinkSuggestionView = {
  performanceAccountId: number;
  subKey: string | null;
  /** e.g. "IRA (Vanguard) — Alex — Roth" or "Alice 401k (Fidelity)". */
  label: string;
};

/**
 * Sub-accounts by key, and a suggested link for each unlinked SimpleFIN
 * account. Suggestions never take a sub-account (or whole account) the
 * household already linked.
 */
export async function loadLinkContext(
  db: Parameters<typeof loadLatestSubAccounts>[0],
  rows: (typeof schema.simplefinAccounts.$inferSelect)[],
) {
  const [subs, perf, people] = await Promise.all([
    loadLatestSubAccounts(db),
    db.select().from(schema.performanceAccounts),
    db
      .select({ id: schema.people.id, name: schema.people.name })
      .from(schema.people),
  ]);
  const names = new Map(people.map((p) => [p.id, p.name]));
  const perfLabel = new Map(
    perf.map((a) => [
      a.id,
      accountDisplayName(
        a,
        a.ownerPersonId != null ? names.get(a.ownerPersonId) : undefined,
      ),
    ]),
  );
  const subByKey = new Map(subs.map((sub) => [sub.key, sub]));
  const takenKeys = new Set(rows.map((r) => r.linkedSubKey).filter(Boolean));
  const takenWhole = new Set(
    rows
      .filter((r) => r.linkedPerformanceAccountId != null && !r.linkedSubKey)
      .map((r) => r.linkedPerformanceAccountId),
  );
  const open = subs.filter(
    (sub) =>
      !takenKeys.has(sub.key) && !takenWhole.has(sub.performanceAccountId),
  );
  const partLinked = new Set(
    rows
      .filter((r) => r.linkedPerformanceAccountId != null && r.linkedSubKey)
      .map((r) => r.linkedPerformanceAccountId!),
  );
  const keyOf = new Map(open.map((sub) => [sub, sub.key]));
  const suggestions = new Map<number, LinkSuggestionView>();
  for (const s of suggestLinks(
    rows
      .filter(
        (r) => r.linkedPerformanceAccountId == null && r.linkedLoanId == null,
      )
      .map((r) => ({
        id: r.id,
        orgName: r.orgName,
        accountName: r.accountName,
        balance: Number(r.lastBalance),
      })),
    open,
    partLinked,
  )) {
    const subKey =
      s.candidate.taxType === null
        ? null
        : (keyOf.get(s.candidate as (typeof open)[number]) ?? null);
    const account = perfLabel.get(s.candidate.performanceAccountId) ?? "";
    suggestions.set(s.simplefinAccountId, {
      performanceAccountId: s.candidate.performanceAccountId,
      subKey,
      label: subKey ? `${account} — ${subByKey.get(subKey)!.label}` : account,
    });
  }

  // A whole-account link whose name states one tax treatment can be narrowed
  // to that tracked account's own free sub-account of that treatment.
  const wholeLinked = new Map<number, typeof rows>();
  for (const r of rows) {
    if (r.linkedPerformanceAccountId == null || r.linkedSubKey) continue;
    const list = wholeLinked.get(r.linkedPerformanceAccountId) ?? [];
    list.push(r);
    wholeLinked.set(r.linkedPerformanceAccountId, list);
  }
  for (const [performanceAccountId, linked] of wholeLinked) {
    const own = subs.filter(
      (sub) => sub.performanceAccountId === performanceAccountId,
    );
    if (own.length < 2) continue;
    const free = own.filter((sub) => !takenKeys.has(sub.key));
    for (const s of suggestLinks(
      linked.map((r) => ({
        id: r.id,
        orgName: r.orgName,
        accountName: r.accountName,
        balance: Number(r.lastBalance),
      })),
      free,
    )) {
      if (s.candidate.taxType === null) continue;
      const sub = s.candidate as (typeof free)[number];
      suggestions.set(s.simplefinAccountId, {
        performanceAccountId,
        subKey: sub.key,
        label: `${perfLabel.get(performanceAccountId) ?? ""} — ${sub.label}`,
      });
    }
  }
  // A whole-account link whose name states a tax treatment the tracked account
  // has no part for: its money has nowhere to go, so say which part to add.
  const missingParts = new Map<number, string>();
  for (const r of rows) {
    if (r.linkedPerformanceAccountId == null || r.linkedSubKey) continue;
    if (suggestions.has(r.id)) continue;
    const kind = recogniseAccountKind(r.accountName);
    if (!kind?.taxType) continue;
    const has = subs.some(
      (sub) =>
        sub.performanceAccountId === r.linkedPerformanceAccountId &&
        sub.taxType === kind.taxType,
    );
    if (!has) missingParts.set(r.id, taxTypeLabel(kind.taxType));
  }
  return { subByKey, suggestions, missingParts };
}

export async function listSimplefinAccounts(ctx: { db: Db }) {
  const [rows, latest] = await Promise.all([
    ctx.db
      .select()
      .from(schema.simplefinAccounts)
      .orderBy(
        asc(schema.simplefinAccounts.orgName),
        asc(schema.simplefinAccounts.accountName),
      ),
    getLatestSnapshot(ctx.db),
  ]);

  // A performance account can be split across multiple snapshot rows
  // (e.g. by tax type), so sum every row that shares its id.
  const snapshotBalanceByPerfId = new Map<number, number>();
  const taxTypesSeenByPerfId = new Map<number, Set<PortfolioTaxType>>();
  const parentCategoryByPerfId = new Map<number, ParentCategory>();
  // accountType/subType live on the performance_accounts master row, so every snapshot
  // row for a performanceAccountId carries the same value: overwriting is safe.
  const accountTypeByPerfId = new Map<number, AccountCategory>();
  const subTypeByPerfId = new Map<number, string | null>();
  if (latest) {
    for (const a of latest.accounts) {
      if (a.performanceAccountId == null) continue;
      snapshotBalanceByPerfId.set(
        a.performanceAccountId,
        (snapshotBalanceByPerfId.get(a.performanceAccountId) ?? 0) + a.amount,
      );
      const taxTypes =
        taxTypesSeenByPerfId.get(a.performanceAccountId) ?? new Set();
      taxTypes.add(a.taxType as PortfolioTaxType);
      taxTypesSeenByPerfId.set(a.performanceAccountId, taxTypes);
      if (
        isRetirementParent(a.parentCategory ?? undefined) ||
        isPortfolioParent(a.parentCategory ?? undefined)
      ) {
        parentCategoryByPerfId.set(
          a.performanceAccountId,
          a.parentCategory as ParentCategory,
        );
      }
      accountTypeByPerfId.set(a.performanceAccountId, a.accountType);
      subTypeByPerfId.set(a.performanceAccountId, a.subType);
    }
  }
  // A performanceAccountId split across >1 tax types in this snapshot has no single
  // tax type: resolve to "mixed" rather than misattribute the balance.
  const taxTypeByPerfId = new Map<number, PortfolioTaxType | "mixed">();
  for (const [perfId, taxTypes] of taxTypesSeenByPerfId) {
    const [only] = taxTypes;
    taxTypeByPerfId.set(perfId, taxTypes.size === 1 && only ? only : "mixed");
  }

  // Group every counted (linked and included) SimpleFIN account's balance
  // by target performanceAccountId, since more than one can point at the
  // same id. Unchecked accounts count for nothing — see countsAsFeed.
  const linkedTotalByPerfId = new Map<number, number>();
  const linkedTotalBySubKey = new Map<string, number>();
  for (const r of rows) {
    if (!countsAsFeed(r) || r.linkedPerformanceAccountId == null) continue;
    if (r.linkedSubKey)
      linkedTotalBySubKey.set(
        r.linkedSubKey,
        (linkedTotalBySubKey.get(r.linkedSubKey) ?? 0) + Number(r.lastBalance),
      );
    linkedTotalByPerfId.set(
      r.linkedPerformanceAccountId,
      (linkedTotalByPerfId.get(r.linkedPerformanceAccountId) ?? 0) +
        Number(r.lastBalance),
    );
  }

  const snapshotDate = latest?.snapshot.snapshotDate ?? null;
  const links = await loadLinkContext(ctx.db, rows);

  return rows.map((r) => {
    const lastBalance = Number(r.lastBalance);
    const base = {
      id: r.id,
      orgName: r.orgName,
      accountName: r.accountName,
      lastBalance,
      lastBalanceDate: r.lastBalanceDate,
      isIncluded: r.isIncluded,
      lastSeenAt: r.lastSeenAt,
      linkedPerformanceAccountId: r.linkedPerformanceAccountId,
      linkedLoanId: r.linkedLoanId,
      unclaimedDebt: isUnclaimedDebt(r),
      // The sub-account it's linked to; a key missing from the latest
      // snapshot (edited or deactivated) is kept and flagged, and the
      // link counts for the whole account meanwhile.
      linkedSubKey:
        r.linkedPerformanceAccountId != null ? r.linkedSubKey : null,
      linkedSubLabel: r.linkedSubKey
        ? (links.subByKey.get(r.linkedSubKey)?.label ?? null)
        : null,
      subLinkMissing:
        r.linkedPerformanceAccountId != null &&
        !!r.linkedSubKey &&
        !links.subByKey.has(r.linkedSubKey),
      suggestion: links.suggestions.get(r.id) ?? null,
      /** Tax treatment (label) of a part this account needs but the tracked account lacks. */
      missingPart: links.missingParts.get(r.id) ?? null,
      snapshotDate,
    };
    if (r.linkedPerformanceAccountId == null || !countsAsFeed(r)) {
      return {
        ...base,
        snapshotBalance: null,
        change: null,
        taxType: null,
        parentCategory: null,
        accountType: null,
        subType: null,
      };
    }
    // A feed linked to one part compares with that part, alongside only
    // the feeds sharing its key — never the whole account's total.
    const part = r.linkedSubKey
      ? links.subByKey.get(r.linkedSubKey)
      : undefined;
    const snapshotBalance = part
      ? part.amount
      : (snapshotBalanceByPerfId.get(r.linkedPerformanceAccountId) ?? null);
    const linkedTotal = part
      ? (linkedTotalBySubKey.get(r.linkedSubKey!) ?? lastBalance)
      : (linkedTotalByPerfId.get(r.linkedPerformanceAccountId) ?? lastBalance);
    return {
      ...base,
      snapshotBalance,
      // Rounded to cents: summing several linked rows can leave a float residue
      // that would show as a "+$0.00" drift badge.
      change:
        snapshotBalance == null
          ? null
          : roundToCents(linkedTotal - snapshotBalance),
      taxType: taxTypeByPerfId.get(r.linkedPerformanceAccountId) ?? null,
      parentCategory:
        parentCategoryByPerfId.get(r.linkedPerformanceAccountId) ?? null,
      accountType:
        accountTypeByPerfId.get(r.linkedPerformanceAccountId) ?? null,
      subType: subTypeByPerfId.get(r.linkedPerformanceAccountId) ?? null,
    };
  });
}
