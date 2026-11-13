/** Invented accounts and saved lump sums for the lump-sum-targets tag: a
 *  named lump sum that matches one account by a stored column of the latest
 *  snapshot gains its id and owner; one that matches none or several gains
 *  a null id; every other lump sum and key stays as stored. */

export const PEOPLE = [
  { id: 61, name: "Invented Earner" },
  { id: 62, name: "Invented Spouse" },
  { id: 63, name: "Invented Twin" },
  { id: 64, name: "Invented Twin" },
] as const;

export const PERFORMANCE_ACCOUNTS = [
  // One owner; matched by display name.
  { id: 81, display_name: "Invented 401k", account_label: "Plan A" },
  // Held in two owners' parts; matched by account label.
  { id: 82, display_name: null, account_label: "Invented Joint IRA" },
  // Two accounts sharing one label.
  { id: 83, display_name: null, account_label: "Invented Shared" },
  { id: 84, display_name: null, account_label: "Invented Shared" },
  // Held only in the older snapshot.
  { id: 85, display_name: "Invented Closed", account_label: "Closed" },
] as const;

/** The latest snapshot (951) and an older one (950). */
export const SNAPSHOTS = [
  { id: 950, snapshot_date: "2025-01-01" },
  { id: 951, snapshot_date: "2026-01-01" },
] as const;

export const PORTFOLIO_ACCOUNTS = [
  {
    snapshot_id: 951,
    id: 901,
    performance_account_id: 81,
    owner_person_id: 61,
    label: null,
  },
  {
    snapshot_id: 951,
    id: 902,
    performance_account_id: 81,
    owner_person_id: 61,
    label: null,
  },
  {
    snapshot_id: 951,
    id: 903,
    performance_account_id: 82,
    owner_person_id: 61,
    label: null,
  },
  {
    snapshot_id: 951,
    id: 904,
    performance_account_id: 82,
    owner_person_id: 62,
    label: null,
  },
  {
    snapshot_id: 951,
    id: 905,
    performance_account_id: 83,
    owner_person_id: 61,
    label: null,
  },
  {
    snapshot_id: 951,
    id: 906,
    performance_account_id: 84,
    owner_person_id: 61,
    label: null,
  },
  // Matched by its snapshot row's own label.
  {
    snapshot_id: 951,
    id: 907,
    performance_account_id: 81,
    owner_person_id: 61,
    label: "Invented Row Label",
  },
  // A row with no performance account matches nothing.
  {
    snapshot_id: 951,
    id: 908,
    performance_account_id: null,
    owner_person_id: 61,
    label: "Invented Loose",
  },
  // The older snapshot: account 81 held then by another owner under another
  // label, and an account since closed. Neither matches.
  {
    snapshot_id: 950,
    id: 909,
    performance_account_id: 81,
    owner_person_id: 62,
    label: "Invented Old Label",
  },
  {
    snapshot_id: 950,
    id: 910,
    performance_account_id: 85,
    owner_person_id: 61,
    label: null,
  },
] as const;

const lumpSum = (extra: Record<string, unknown>) => ({
  amount: 1000,
  targetAccount: "401k",
  taxType: "traditional",
  ...extra,
});

const id81 = { targetPerformanceAccountId: 81, targetOwnerPersonId: 61 };

export type LumpSumCase = {
  readonly id: number;
  readonly type: string;
  readonly before: readonly unknown[];
  readonly after: readonly unknown[];
};

export const SETS: readonly LumpSumCase[] = [
  {
    id: 701,
    type: "accumulation",
    before: [
      {
        year: 2030,
        lumpSums: [lumpSum({ targetAccountName: "Invented 401k" })],
      },
      // No lump sums, and an unnamed one: untouched.
      { year: 2031, contributionRate: 0.1 },
      { year: 2032, lumpSums: [lumpSum({})] },
    ],
    after: [
      {
        year: 2030,
        lumpSums: [lumpSum({ targetAccountName: "Invented 401k", ...id81 })],
      },
      { year: 2031, contributionRate: 0.1 },
      { year: 2032, lumpSums: [lumpSum({})] },
    ],
  },
  {
    id: 702,
    type: "decumulation",
    before: [
      {
        year: 2050,
        lumpSums: [
          // By the row's label, with its owner named.
          lumpSum({
            targetAccountName: "Invented Row Label",
            targetOwnerName: "Invented Earner",
          }),
          // An account held in parts: the owner picks the part.
          lumpSum({
            targetAccountName: "Invented Joint IRA",
            targetOwnerName: "Invented Spouse",
          }),
          // The same with no owner: two parts, no single match.
          lumpSum({ targetAccountName: "Invented Joint IRA" }),
          // Two accounts on one label: no single match.
          lumpSum({ targetAccountName: "Invented Shared" }),
          // An owner name two people share: no single owner.
          lumpSum({
            targetAccountName: "Invented 401k",
            targetOwnerName: "Invented Twin",
          }),
          // A name no stored column holds.
          lumpSum({ targetAccountName: "Invented Loose" }),
          // Only the older snapshot holds these: a label, an owner, an
          // account since closed.
          lumpSum({ targetAccountName: "Invented Old Label" }),
          lumpSum({
            targetAccountName: "Invented 401k",
            targetOwnerName: "Invented Spouse",
          }),
          lumpSum({ targetAccountName: "Invented Closed" }),
          // Already holding the key: left as stored, whatever it holds.
          lumpSum({
            targetAccountName: "Invented 401k",
            targetPerformanceAccountId: 84,
          }),
        ],
      },
    ],
    after: [
      {
        year: 2050,
        lumpSums: [
          lumpSum({
            targetAccountName: "Invented Row Label",
            targetOwnerName: "Invented Earner",
            ...id81,
          }),
          lumpSum({
            targetAccountName: "Invented Joint IRA",
            targetOwnerName: "Invented Spouse",
            targetPerformanceAccountId: 82,
            targetOwnerPersonId: 62,
          }),
          lumpSum({
            targetAccountName: "Invented Joint IRA",
            targetPerformanceAccountId: null,
          }),
          lumpSum({
            targetAccountName: "Invented Shared",
            targetPerformanceAccountId: null,
          }),
          lumpSum({
            targetAccountName: "Invented 401k",
            targetOwnerName: "Invented Twin",
            targetPerformanceAccountId: null,
          }),
          lumpSum({
            targetAccountName: "Invented Loose",
            targetPerformanceAccountId: null,
          }),
          lumpSum({
            targetAccountName: "Invented Old Label",
            targetPerformanceAccountId: null,
          }),
          lumpSum({
            targetAccountName: "Invented 401k",
            targetOwnerName: "Invented Spouse",
            targetPerformanceAccountId: null,
          }),
          lumpSum({
            targetAccountName: "Invented Closed",
            targetPerformanceAccountId: null,
          }),
          lumpSum({
            targetAccountName: "Invented 401k",
            targetPerformanceAccountId: 84,
          }),
        ],
      },
    ],
  },
  {
    id: 703,
    type: "brokerage",
    before: [
      {
        id: "e1",
        year: "2031",
        amount: "500",
        targetAccount: "brokerage",
        targetAccountName: "Invented 401k",
        targetOwnerName: "",
        taxType: "",
        label: "",
      },
      {
        id: "e2",
        year: "2032",
        amount: "500",
        targetAccount: "brokerage",
        targetAccountName: "",
        targetOwnerName: "",
        taxType: "",
        label: "",
      },
    ],
    after: [
      {
        id: "e1",
        year: "2031",
        amount: "500",
        targetAccount: "brokerage",
        targetAccountName: "Invented 401k",
        targetOwnerName: "",
        taxType: "",
        label: "",
        ...id81,
      },
      {
        id: "e2",
        year: "2032",
        amount: "500",
        targetAccount: "brokerage",
        targetAccountName: "",
        targetOwnerName: "",
        taxType: "",
        label: "",
      },
    ],
  },
];

/** The saved sets the converter writes. */
export const WRITTEN = [701, 702, 703];

/** The cases' rows as INSERTs with `?` placeholders, in an order the
 *  foreign keys accept. */
export function seedStatements(): [string, unknown[]][] {
  const out: [string, unknown[]][] = [];
  for (const p of PEOPLE)
    out.push([
      "INSERT INTO people (id, name, date_of_birth) VALUES (?, ?, '1980-01-01')",
      [p.id, p.name],
    ]);
  for (const a of PERFORMANCE_ACCOUNTS)
    out.push([
      "INSERT INTO performance_accounts (id, institution, account_type, account_label, display_name, ownership_type, parent_category) VALUES (?, 'Invented Bank', '401k', ?, ?, 'individual', 'Retirement')",
      [a.id, a.account_label, a.display_name],
    ]);
  for (const s of SNAPSHOTS)
    out.push([
      "INSERT INTO portfolio_snapshots (id, snapshot_date) VALUES (?, ?)",
      [s.id, s.snapshot_date],
    ]);
  for (const r of PORTFOLIO_ACCOUNTS)
    out.push([
      "INSERT INTO portfolio_accounts (id, snapshot_id, institution, tax_type, amount, account_type, label, owner_person_id, performance_account_id) VALUES (?, ?, 'Invented Bank', 'preTax', 1000, '401k', ?, ?, ?)",
      [
        r.id,
        r.snapshot_id,
        r.label,
        r.owner_person_id,
        r.performance_account_id,
      ],
    ]);
  for (const c of SETS)
    out.push([
      "INSERT INTO projection_overrides (id, override_type, overrides) VALUES (?, ?, ?)",
      [c.id, c.type, JSON.stringify(c.before)],
    ]);
  return out;
}
