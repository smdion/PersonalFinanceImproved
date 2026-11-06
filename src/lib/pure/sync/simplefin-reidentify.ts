/** The stored SimpleFIN account a newly reported id belongs to, when only
 *  the id changed (an institution re-added in SimpleFIN Bridge). Pure; the
 *  sync applies the plan before its account upsert. */

export type StoredFeedIdentity = {
  id: number;
  externalAccountId: string;
  orgName: string;
  accountName: string;
  linkedPerformanceAccountId: number | null;
  linkedSubKey: string | null;
  linkedLoanId: number | null;
  lastSeenAt: Date;
  /** When its earliest stored balance, holding or transaction was written. */
  firstHistoryAt: Date | null;
};

export type ReportedFeedIdentity = {
  id: string;
  orgName: string;
  name: string;
};

/** What an answer's errors may have left out: every institution (an error
 *  that names none), or these institutions. */
export type ErrorScope = "any" | readonly string[];

type AmbiguousReason =
  /** More than one row, or more than one reported account, could pair. */
  | "several_candidates"
  /** The reported copy already has a link of its own. */
  | "reported_copy_linked"
  /** Neither copy has a link to say which is the account. */
  | "neither_linked"
  /** A linked account of the institution still reports under its old id:
   *  the institution wasn't re-added, so this one is only missing. */
  | "institution_still_reporting"
  /** The copy has history from while the row was still reported: two
   *  accounts reported side by side, not one under a new id. */
  | "reported_together"
  /** A linked account went away while a differently named one arrived at
   *  its institution: maybe renamed. */
  | "name_changed";

export type ReidentifyPlan = {
  /** A row takes a newly reported id (no row exists for that id yet). */
  adopt: { rowId: number; externalAccountId: string }[];
  /** A row takes the id of the unlinked copy already stored for it; the
   *  copy's history moves onto the row and the copy is deleted. */
  merge: { keepId: number; dropId: number; externalAccountId: string }[];
  /** Left as they are, for the household to resolve. */
  ambiguous: { ids: number[]; reason: AmbiguousReason }[];
};

const hasLink = (r: StoredFeedIdentity) =>
  r.linkedPerformanceAccountId != null ||
  r.linkedSubKey != null ||
  r.linkedLoanId != null;

/** Institutions an answer's errors may have hidden accounts of: a
 *  connection error covers its institution; one naming no account or
 *  connection, or an unreadable account, covers all. */
export function errorScope(
  body: {
    errors?: readonly string[];
    errlist?: readonly { msg: string; account_id?: string; conn_id?: string }[];
  },
  /** `unreadable`: accounts left out because not even their id could be read. */
  read: { unreadable: number },
  connectionNames: ReadonlyMap<string, string>,
  notice: RegExp,
): ErrorScope {
  if (read.unreadable > 0) return "any";
  const errlist = (body.errlist ?? []).filter((e) => !notice.test(e.msg));
  const listed = new Set(errlist.map((e) => e.msg));
  const unlisted = (body.errors ?? []).filter(
    (m) => !notice.test(m) && !listed.has(m),
  );
  if (unlisted.length > 0) return "any";
  const orgs = new Set<string>();
  for (const e of errlist) {
    if (e.account_id) continue;
    const org = e.conn_id ? connectionNames.get(e.conn_id) : undefined;
    if (org === undefined) return "any";
    orgs.add(org);
  }
  return [...orgs];
}

/** How long a row must go unreported before it counts as gone. A silent
 *  drop clears within the partial-sync retries (hourly, then the next day);
 *  a re-added institution never sends the old id again. */
export const GONE_AFTER_HOURS = 24;
/** Clock slack between the app (lastSeenAt) and the database (createdAt). */
const CLOCK_SLACK_MS = 5 * 60_000;

const keyOf = (org: string, name: string) => `${org}\u0000${name}`;

function groupBy<T>(items: readonly T[], key: (t: T) => string) {
  const out = new Map<string, T[]>();
  for (const t of items) {
    const k = key(t);
    out.set(k, [...(out.get(k) ?? []), t]);
  }
  return out;
}

/** Pair each gone row (unreported for GONE_AFTER_HOURS, unnamed by an
 *  error, institution not under one) with its account by institution and
 *  name: adopt a new id, or merge an unlinked copy. One-to-one pairs only. */
export function planReidentify(args: {
  stored: readonly StoredFeedIdentity[];
  reported: readonly ReportedFeedIdentity[];
  erroredIds: ReadonlySet<string>;
  errorScope: ErrorScope;
  now: Date;
}): ReidentifyPlan {
  const plan: ReidentifyPlan = { adopt: [], merge: [], ambiguous: [] };
  const reportedIds = new Set(args.reported.map((a) => a.id));
  const known = new Set(args.stored.map((r) => r.externalAccountId));
  const scope = args.errorScope;
  const goneBefore = args.now.getTime() - GONE_AFTER_HOURS * 3_600_000;
  const gone = (r: StoredFeedIdentity) =>
    r.lastSeenAt.getTime() <= goneBefore &&
    !reportedIds.has(r.externalAccountId) &&
    !args.erroredIds.has(r.externalAccountId) &&
    scope !== "any" &&
    !scope.includes(r.orgName);
  const newcomers = [
    ...new Map(
      args.reported
        .filter((a) => a.orgName !== "" && !known.has(a.id))
        .map((a) => [a.id, a]),
    ).values(),
  ];
  const rowsByKey = groupBy(
    args.stored.filter((r) => r.orgName !== ""),
    (r) => keyOf(r.orgName, r.accountName),
  );
  const newByKey = groupBy(newcomers, (a) => keyOf(a.orgName, a.name));
  // A re-added institution comes back whole: none of its linked rows is
  // still reported under its old id (a linked copy with a gone twin is new).
  const stillReporting = new Set(
    args.stored
      .filter(
        (r) =>
          hasLink(r) &&
          reportedIds.has(r.externalAccountId) &&
          !rowsByKey.get(keyOf(r.orgName, r.accountName))?.some(gone),
      )
      .map((r) => r.orgName),
  );

  for (const [key, rows] of rowsByKey) {
    const goneRows = rows.filter(gone);
    if (goneRows.length === 0) continue;
    const ids = rows.map((r) => r.id);
    const news = newByKey.get(key) ?? [];
    const live = rows.filter((r) => reportedIds.has(r.externalAccountId));
    if (news.length + live.length === 0) continue;
    if (stillReporting.has(rows[0]!.orgName)) {
      plan.ambiguous.push({ ids, reason: "institution_still_reporting" });
      continue;
    }
    if (news.length > 0) {
      if (news.length === 1 && rows.length === 1)
        plan.adopt.push({ rowId: rows[0]!.id, externalAccountId: news[0]!.id });
      else plan.ambiguous.push({ ids, reason: "several_candidates" });
      continue;
    }
    if (rows.length !== 2 || live.length !== 1 || goneRows.length !== 1) {
      plan.ambiguous.push({ ids, reason: "several_candidates" });
      continue;
    }
    const [copy, row] = [live[0]!, goneRows[0]!];
    if (hasLink(copy))
      plan.ambiguous.push({ ids, reason: "reported_copy_linked" });
    else if (!hasLink(row))
      plan.ambiguous.push({ ids, reason: "neither_linked" });
    else if (
      copy.firstHistoryAt &&
      copy.firstHistoryAt.getTime() <= row.lastSeenAt.getTime() + CLOCK_SLACK_MS
    )
      plan.ambiguous.push({ ids, reason: "reported_together" });
    else
      plan.merge.push({
        keepId: row.id,
        dropId: copy.id,
        externalAccountId: copy.externalAccountId,
      });
  }

  // A newcomer no row shares a name with, at an institution where a linked
  // row went away with nothing reported under its name: maybe a rename.
  const unmatchedOrgs = new Set(
    newcomers
      .filter((a) => !rowsByKey.has(keyOf(a.orgName, a.name)))
      .map((a) => a.orgName),
  );
  for (const org of unmatchedOrgs) {
    const orphans = args.stored.filter(
      (r) =>
        r.orgName === org &&
        hasLink(r) &&
        gone(r) &&
        (rowsByKey.get(keyOf(r.orgName, r.accountName)) ?? []).every(
          (x) => !reportedIds.has(x.externalAccountId),
        ) &&
        !newByKey.has(keyOf(r.orgName, r.accountName)),
    );
    if (orphans.length > 0)
      plan.ambiguous.push({
        ids: orphans.map((r) => r.id),
        reason: "name_changed",
      });
  }
  return plan;
}

type StoredTxn = {
  id: number;
  externalId: string;
  posted: string;
  amount: number;
  description: string;
  pending: boolean;
  voided: boolean;
};

/** The copy's transactions that are the kept row's under a new SimpleFIN
 *  id (a re-added institution mints new ones): same day, amount, pending
 *  state and text (or one side redacted). One to one, in id order. */
export function pairCopiedTransactions(
  kept: readonly StoredTxn[],
  copy: readonly StoredTxn[],
  redacted: string,
): { keptId: number; copyId: number; externalId: string }[] {
  const copyExts = new Set(copy.map((t) => t.externalId));
  const keptExts = new Set(kept.map((t) => t.externalId));
  const open = [...kept]
    .sort((a, b) => a.id - b.id)
    .filter((k) => !k.voided && !copyExts.has(k.externalId));
  const pairs: { keptId: number; copyId: number; externalId: string }[] = [];
  for (const c of [...copy].sort((a, b) => a.id - b.id)) {
    if (keptExts.has(c.externalId)) continue;
    const i = open.findIndex(
      (k) =>
        k.posted === c.posted &&
        k.amount === c.amount &&
        k.pending === c.pending &&
        (k.description === c.description ||
          k.description === redacted ||
          c.description === redacted),
    );
    if (i < 0) continue;
    pairs.push({ keptId: open[i]!.id, copyId: c.id, externalId: c.externalId });
    open.splice(i, 1);
  }
  return pairs;
}
