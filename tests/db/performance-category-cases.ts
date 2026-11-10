/**
 * Invented performance accounts and account-years for the account-year
 * category shape (stored-JSON tag, v0106-performance-category.ts): each
 * row's parent_category as stored and as the shape stores it, for the
 * restore step and both migrators.
 */

/** Performance accounts as a database row (snake_case). */
export const PERFORMANCE_ACCOUNTS = [
  { id: 1, category: "Retirement" },
  { id: 2, category: "Portfolio" },
].map((a) => ({
  id: a.id,
  institution: "Invented Bank",
  account_type: "brokerage",
  account_label: `Invented ${a.id}`,
  ownership_type: "individual",
  parent_category: a.category,
}));

type YearCase = { id: number; account: number; before: string; after: string };

export const YEARS: YearCase[] = [
  // Agrees with its account: untouched.
  { id: 11, account: 1, before: "Retirement", after: "Retirement" },
  { id: 12, account: 2, before: "Portfolio", after: "Portfolio" },
  // Disagrees: takes its account's, which every read already used.
  { id: 13, account: 1, before: "Portfolio", after: "Retirement" },
  { id: 14, account: 2, before: "Retirement", after: "Portfolio" },
];

/** Row ids the converter writes. */
export const WRITTEN = [13, 14];

/** Each account-year as a database row. */
export const yearRows = () =>
  YEARS.map((y) => ({
    id: y.id,
    year: 2020 + y.id,
    institution: "Invented Bank",
    account_label: `Invented ${y.account}`,
    beginning_balance: "100",
    total_contributions: "0",
    yearly_gain_loss: "0",
    ending_balance: "100",
    parent_category: y.before,
    performance_account_id: y.account,
  }));
