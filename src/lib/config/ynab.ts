/**
 * YNAB's own category groups and categories that aren't household
 * spending — read by the server's YNAB client and by client pages, so they
 * live here, not in the (server-only) client module.
 */
/** YNAB internal category groups that should never surface in our app. */
export const YNAB_INTERNAL_GROUPS = new Set([
  "Internal Master Category",
  "Hidden Categories",
]);

/** YNAB category names excluded from expense comparisons (system/non-expense categories). */
export const YNAB_EXPENSE_EXCLUDED_CATEGORIES = new Set([
  "Split", // parent of split txns — children carry real categories
  "Inflow: Ready to Assign", // income inflows, not expenses
  "Uncategorized", // unassigned noise until categorized
]);

/** YNAB category groups excluded from expense views (not real spending). */
export const YNAB_EXPENSE_EXCLUDED_GROUPS = new Set([
  "Credit Card Payments", // internal transfers between accounts
]);
