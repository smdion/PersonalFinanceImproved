/**
 * Invented rows for the credentials tag's cached-months step: an active
 * YNAB connection's goals and links, a month savings history already
 * holds, and cached months in every form (a month some goals take, one
 * whose categories are in an older shape, an empty one, a key that names
 * no month, another service's month), plus cache entries that aren't
 * months. Every month is purged; only the active service's linked active
 * goals gain a row, never one savings_monthly already holds.
 */
export const SETTINGS = [{ id: 900, key: "active_budget_api", value: "ynab" }];

export const GOALS = [
  { id: 1, name: "Invented trip", is_active: true },
  { id: 2, name: "Invented roof", is_active: true },
  { id: 3, name: "Invented old fund", is_active: false },
];

const link = (
  id: number,
  goal: number,
  service: string,
  role: string,
  category: string,
) => ({
  id,
  savings_goal_id: goal,
  service,
  role,
  category_id: category,
});

export const LINKS = [
  link(1, 1, "ynab", "primary", "cat-trip"),
  link(2, 2, "ynab", "primary", "cat-roof"),
  link(3, 2, "ynab", "reimbursement", "cat-refund"),
  link(4, 3, "ynab", "primary", "cat-old"),
  link(5, 1, "actual", "primary", "act-trip"),
];

/** A month savings history already holds: the step never writes over it. */
export const HELD = [
  { id: 1, goal_id: 1, month_date: "2026-09-01", balance: "100" },
];

const cached = (id: number, service: string, key: string, data: unknown) => ({
  id,
  service,
  cache_key: key,
  data,
});

export const CACHE = [
  cached(1, "ynab", "months/2026-09-01", {
    categories: [
      { id: "cat-trip", balance: 150 },
      { id: "cat-roof", balance: 20 },
      { id: "cat-refund", balance: 7 },
    ],
  }),
  cached(2, "ynab", "months/2026-10-01", {
    categories: [
      { id: "cat-trip", balance: 175.5 },
      { id: "cat-old", balance: 5 },
      { id: "cat-roof", balance: "40" },
      { id: 9, balance: 1 },
    ],
  }),
  cached(3, "ynab", "months/2026-11-01", { month: "2026-11-01" }),
  cached(4, "ynab", "months/not-a-month", {
    categories: [{ id: "cat-trip", balance: 1 }],
  }),
  cached(5, "actual", "months/2026-10-01", {
    categories: [{ id: "act-trip", balance: 9 }],
  }),
  cached(6, "ynab", "accounts", []),
  cached(7, "ynab", "categories", []),
];

/** The rows the step adds (goal, month, balance as the sync writes it). */
export const HARVESTED = [
  { goal_id: 2, month_date: "2026-09-01", balance: "20" },
  { goal_id: 1, month_date: "2026-10-01", balance: "175.5" },
];

/** The cache entries left: the ones that aren't months. */
export const KEPT_CACHE_IDS = [6, 7];
