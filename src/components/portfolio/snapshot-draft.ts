type PortfolioTaxType = "preTax" | "taxFree" | "hsa" | "afterTax";
type PortfolioAccountType = string; // Derived from DB text column; validated by ACCOUNT_TYPE_CONFIG

export type AccountRow = {
  key: string; // stable key for React
  institution: string;
  accountType: PortfolioAccountType;
  subType: string | null;
  label: string | null;
  taxType: PortfolioTaxType;
  ownerPersonId: number | null;
  amount: string; // editable string
  previousAmount: number; // from latest snapshot, 0 for new rows
  performanceAccountId: number | null; // FK to performance_accounts master
  /** True when the linked master account is closed: the server records $0
   *  whatever is submitted (resolveSnapshotAccountAmounts), so the row is
   *  held at $0 here too. */
  isClosedAccount: boolean;
  /** Set when the amount came from a SimpleFIN fill. */
  filled?: true;
};

// ── Local draft (browser only) ──────────────────────────────────────────
// Lets the ~30-field snapshot form be resumed. Keyed by snapshot date, so a new date
// never inherits a stale draft; one per date per browser, not shared across devices.

const DRAFT_PREFIX = "pf-snapshot-draft:";
/** The draft shape's stamp; a draft without it is dropped, not read. */
const DRAFT_VERSION = 1;

export type SnapshotDraft = {
  version: typeof DRAFT_VERSION;
  snapshotDate: string;
  notes: string;
  /** The `getLatest` snapshot id the rows were prefilled from — lets a
   *  resume detect that the account set changed and reconcile. */
  sourceSnapshotId: number | null;
  savedAt: number;
  rows: {
    performanceAccountId: number | null;
    institution: string;
    accountType: string;
    taxType: PortfolioTaxType;
    subType: string | null;
    label: string | null;
    ownerPersonId: number | null;
    amount: string;
  }[];
};

function draftKey(date: string) {
  return `${DRAFT_PREFIX}${date}`;
}

/** Parsed browser storage is any JSON; only a stamped draft is read. */
function isCurrentDraft(value: unknown): value is SnapshotDraft {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === DRAFT_VERSION &&
    "rows" in value &&
    Array.isArray(value.rows)
  );
}

export function readDraft(date: string): SnapshotDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(date));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isCurrentDraft(parsed)) return parsed;
    window.localStorage.removeItem(draftKey(date));
    return null;
  } catch {
    return null;
  }
}

export function writeDraft(d: Omit<SnapshotDraft, "version">): void {
  try {
    const stamped: SnapshotDraft = { version: DRAFT_VERSION, ...d };
    window.localStorage.setItem(
      draftKey(d.snapshotDate),
      JSON.stringify(stamped),
    );
  } catch {
    /* private mode / quota — a lost draft is acceptable */
  }
}

export function clearDraft(date: string): void {
  try {
    window.localStorage.removeItem(draftKey(date));
  } catch {
    /* ignore */
  }
}

type DraftRowIdentity = Pick<
  AccountRow,
  | "performanceAccountId"
  | "institution"
  | "accountType"
  | "taxType"
  | "subType"
  | "label"
  | "ownerPersonId"
>;

/** A row's identity within a snapshot. One account holds several rows
 *  (Traditional / Roth parts, one per owner), so the account id alone
 *  isn't enough. */
function draftRowKey(r: DraftRowIdentity): string {
  // A linked row is its account's; only an unlinked row needs institution.
  return JSON.stringify([
    r.performanceAccountId ?? r.institution,
    r.accountType,
    r.taxType,
    r.subType,
    r.label,
    r.ownerPersonId,
  ]);
}

/** Overlay a draft's typed amounts and notes onto a fresh row set, keeping
 *  the current accounts (added appear, removed are gone). Rows sharing an
 *  identity match in order. */
export function reconcileDraft(
  base: AccountRow[],
  draft: SnapshotDraft,
): AccountRow[] {
  const amounts = new Map<string, string[]>();
  for (const r of draft.rows) {
    const key = draftRowKey(r);
    amounts.set(key, [...(amounts.get(key) ?? []), r.amount]);
  }
  return base.map((row) => {
    if (row.isClosedAccount) return row; // server zeroes these regardless
    const draftAmount = amounts.get(draftRowKey(row))?.shift();
    return draftAmount === undefined ? row : { ...row, amount: draftAmount };
  });
}
