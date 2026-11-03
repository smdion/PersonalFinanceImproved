/**
 * YNAB responses as the `/budgets` paths send them, built field by field
 * from YNAB API spec 1.88.0's objects (YNAB can't be recorded live).
 * Every field the spec requires is present; override what a test needs.
 */

export function ynabAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: "acct-1",
    name: "Checking",
    type: "checking",
    on_budget: true,
    closed: false,
    note: null,
    balance: 0,
    cleared_balance: 0,
    uncleared_balance: 0,
    transfer_payee_id: "payee-transfer-1",
    direct_import_linked: false,
    direct_import_in_error: false,
    deleted: false,
    ...overrides,
  };
}

export function ynabCategory(overrides: Record<string, unknown> = {}) {
  return {
    id: "cat-1",
    category_group_id: "g1",
    name: "Rent",
    hidden: false,
    internal: false,
    note: null,
    budgeted: 0,
    activity: 0,
    balance: 0,
    goal_type: null,
    goal_target: null,
    goal_cadence: null,
    goal_cadence_frequency: null,
    deleted: false,
    ...overrides,
  };
}

export function ynabTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: "tx-1",
    date: "2026-01-15",
    amount: -25000,
    memo: null,
    cleared: "cleared",
    approved: true,
    flag_color: null,
    account_id: "acct-1",
    account_name: "Checking",
    payee_id: null,
    payee_name: null,
    category_id: null,
    category_name: null,
    transfer_account_id: null,
    import_id: null,
    deleted: false,
    subtransactions: [],
    ...overrides,
  };
}

export function ynabMonth(overrides: Record<string, unknown> = {}) {
  return {
    month: "2026-01-01",
    note: null,
    income: 0,
    budgeted: 0,
    activity: 0,
    to_be_budgeted: 0,
    age_of_money: null,
    deleted: false,
    categories: [],
    ...overrides,
  };
}
