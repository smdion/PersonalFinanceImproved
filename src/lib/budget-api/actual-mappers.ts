/** Actual Budget's wrapper responses as the app's budget types, for actual-client.ts. */
import type {
  BudgetAccount,
  BudgetCategoryGroup,
  BudgetCategory,
  BudgetMonth,
  BudgetMonthDetail,
  BudgetTransaction,
} from "./types";
import { fromCents } from "./conversions";
import type {
  ActualAccount,
  ActualCategoryGroup,
  ActualMonth,
  ActualPayee,
  ActualTransaction,
} from "./actual-schemas";

/** A category's fields as the mappers read them: `/categories` has no
 *  numbers, a month's income category has none either. */
export type CategoryFields = {
  id: string;
  name: string;
  group_id: string;
  hidden: boolean;
  budgeted?: number;
  spent?: number;
  balance?: number;
};

// -- Conversion helpers --

export function mapAccount(a: ActualAccount): BudgetAccount {
  return {
    id: a.id,
    name: a.name,
    // The wrapper's account list carries no type.
    type: "other",
    onBudget: !a.offbudget,
    closed: a.closed,
    // The list has no balances: getAccounts reads each one, or stops.
    balance: 0,
    clearedBalance: 0, // Actual doesn't distinguish
  };
}

function mapCategory(c: CategoryFields, groupName: string): BudgetCategory {
  return {
    id: c.id,
    name: c.name,
    groupId: c.group_id,
    groupName,
    hidden: c.hidden,
    budgeted: fromCents(c.budgeted ?? 0),
    activity: fromCents(c.spent ?? 0),
    balance: fromCents(c.balance ?? 0),
    // Set from the category's note (overlayNoteGoals); Actual sends none.
    goalTarget: undefined,
  };
}

export function mapCategoryGroup(
  g: ActualCategoryGroup & { categories: CategoryFields[] },
): BudgetCategoryGroup {
  return {
    id: g.id,
    name: g.name,
    hidden: g.hidden || g.is_income,
    isIncome: g.is_income,
    categories: g.categories.map((c) => mapCategory(c, g.name)),
  };
}

function mapMonth(m: ActualMonth): BudgetMonth {
  return {
    month: m.month,
    income: fromCents(m.totalIncome),
    // totalBudgeted comes back negative (an outflow from ready-to-assign)
    // while per-category `budgeted` is positive; Math.abs keeps this
    // summary on the same "positive = allocated" convention as YNAB.
    budgeted: Math.abs(fromCents(m.totalBudgeted)),
    activity: fromCents(m.totalSpent),
    toBeBudgeted: m.toBudget === null ? null : fromCents(m.toBudget),
  };
}

export function mapMonthDetail(m: ActualMonth): BudgetMonthDetail {
  const categories = m.categoryGroups.flatMap((g) =>
    g.categories.map((c) => mapCategory(c, g.name)),
  );
  return {
    ...mapMonth(m),
    categories,
  };
}

/** Names for a transaction's ids. A lookup without the id gives `null`:
 *  an id is never shown as a name. */
type TransactionNames = {
  accountName: string;
  categories: ReadonlyMap<string, string>;
  payees: ReadonlyMap<string, string>;
};

export const NO_NAMES: TransactionNames = {
  accountName: "",
  categories: new Map(),
  payees: new Map(),
};

function nameOf(
  names: ReadonlyMap<string, string>,
  id: string | null | undefined,
): string | null {
  return id ? (names.get(id) ?? null) : null;
}

/** Payee id to name. A transfer payee with no name of its own takes its
 *  account's name. */
export function payeeNames(
  payees: ActualPayee[],
  accounts: ActualAccount[],
): Map<string, string> {
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));
  const out = new Map<string, string>();
  for (const p of payees) {
    const name =
      p.name?.trim() || (p.transfer_acct && accountNames.get(p.transfer_acct));
    if (name) out.set(p.id, name);
  }
  return out;
}

export function mapTransaction(
  t: ActualTransaction,
  names: TransactionNames,
): BudgetTransaction {
  return {
    id: t.id,
    accountId: t.account,
    accountName: names.accountName,
    date: t.date,
    amount: fromCents(t.amount),
    payeeName: nameOf(names.payees, t.payee),
    categoryId: t.category ?? null,
    categoryName: nameOf(names.categories, t.category),
    memo: t.notes ?? null,
    cleared: t.cleared || t.reconciled,
    approved: true, // Actual doesn't have approved flag
    deleted: false,
    ...(t.subtransactions.length && {
      subtransactions: t.subtransactions
        .filter((st) => !st.tombstone)
        .map((st) => ({
          categoryId: st.category ?? null,
          categoryName: nameOf(names.categories, st.category),
          amount: fromCents(st.amount),
          memo: st.notes ?? null,
        })),
    }),
  };
}
