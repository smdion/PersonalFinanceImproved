/**
 * Reconcile one account's SimpleFIN transaction window against what is
 * already stored. Pure — decides inserts, updates and soft-voids; the
 * ingest layer applies them.
 *
 * Stored history can't be re-fetched (SimpleFIN keeps ~90 days), so voiding
 * is deliberately conservative: only when the account responded cleanly,
 * only for rows whose date is fully inside the requested window, and never
 * more than a capped number per run.
 */

export type IncomingTransaction = {
  externalId: string;
  /** "YYYY-MM-DD" posting date (already in its stored form). */
  posted: string;
  amount: number;
  /** Already in its stored form (e.g. redacted). */
  description: string;
  pending: boolean;
};

export type StoredTransaction = IncomingTransaction & {
  id: number;
  voided: boolean;
};

export type ReconcilePlan = {
  inserts: IncomingTransaction[];
  updates: Array<{ id: number; next: IncomingTransaction }>;
  /** Ids to soft-void. */
  voids: number[];
  warnings: string[];
};

/** Days a pending row may differ from its posted replacement. */
const PENDING_MATCH_DAYS = 5;
/** Minimum void cap per run; the cap is the larger of this and 10% of the window. */
const MIN_VOID_CAP = 5;

function dayDiff(a: string, b: string): number {
  return (
    Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) /
    864e5
  );
}

function sameContent(a: IncomingTransaction, b: IncomingTransaction): boolean {
  return (
    a.posted === b.posted &&
    a.amount === b.amount &&
    a.description === b.description &&
    a.pending === b.pending
  );
}

export function planReconcile(args: {
  incoming: readonly IncomingTransaction[];
  stored: readonly StoredTransaction[];
  /** "YYYY-MM-DD" — the start-date that was requested. */
  windowStart: string;
  /** The response named this account in an error — never void on a bad response. */
  accountHasError: boolean;
}): ReconcilePlan {
  const { incoming, stored, windowStart, accountHasError } = args;
  const plan: ReconcilePlan = {
    inserts: [],
    updates: [],
    voids: [],
    warnings: [],
  };
  const storedByExternal = new Map(stored.map((s) => [s.externalId, s]));
  const incomingIds = new Set(incoming.map((t) => t.externalId));

  const newPosted: IncomingTransaction[] = [];
  for (const t of incoming) {
    const existing = storedByExternal.get(t.externalId);
    if (!existing) {
      plan.inserts.push(t);
      if (!t.pending) newPosted.push(t);
    } else if (!sameContent(existing, t) || existing.voided) {
      plan.updates.push({ id: existing.id, next: t });
    }
  }

  // Pending rows that disappeared because they posted under a new id:
  // match one-to-one (equal same-day rows exist — one per fund per payday).
  const claimed = new Set<number>();
  for (const posted of newPosted) {
    const match = stored.find(
      (s) =>
        s.pending &&
        !s.voided &&
        !incomingIds.has(s.externalId) &&
        !claimed.has(s.id) &&
        s.amount === posted.amount &&
        s.description === posted.description &&
        dayDiff(s.posted, posted.posted) <= PENDING_MATCH_DAYS,
    );
    if (match) {
      claimed.add(match.id);
      plan.voids.push(match.id);
    }
  }

  // Anything else missing from a window that fully covers it.
  if (accountHasError) return plan;
  const inWindow = stored.filter((s) => !s.voided && s.posted > windowStart);
  const missing = inWindow.filter(
    (s) => !incomingIds.has(s.externalId) && !claimed.has(s.id),
  );
  const cap = Math.max(MIN_VOID_CAP, Math.floor(inWindow.length * 0.1));
  if (missing.length > cap) {
    plan.warnings.push(
      `${missing.length} stored transactions are missing from SimpleFIN's latest response — more than the ${cap} allowed per sync, so none were removed. Check the account at the institution.`,
    );
    return plan;
  }
  plan.voids.push(...missing.map((s) => s.id));
  return plan;
}
