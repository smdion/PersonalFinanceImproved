/** SimpleFIN link context: sub-accounts by key and link suggestions for the
 *  household's SimpleFIN accounts, read by the simplefin router. */
import * as schema from "@/lib/db/schema";
import { loadLatestSubAccounts } from "@/server/data/sub-accounts";
import { suggestLinks } from "@/lib/pure/sync/simplefin-link-suggestions";
import { recogniseAccountKind } from "@/lib/config/simplefin-account-kinds";
import { taxTypeLabel } from "@/lib/utils/colors";
import { accountDisplayName } from "@/lib/utils/format";

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
