/** YNAB's responses as the app's budget types, for ynab-client.ts. */
import type {
  BudgetAccount,
  BudgetCategoryGroup,
  BudgetCategory,
  BudgetMonth,
  BudgetMonthDetail,
  BudgetTransaction,
} from "./types";
import { fromMilliunits } from "./conversions";
import type {
  YnabAccount,
  YnabCategory,
  YnabCategoryGroup,
  YnabMonth,
  YnabTransaction,
} from "./ynab-schemas";
import { YNAB_INTERNAL_GROUPS } from "@/lib/config/ynab";

// -- Account type mapping --

const YNAB_ACCOUNT_TYPE_MAP: Record<string, BudgetAccount["type"]> = {
  checking: "checking",
  savings: "savings",
  cash: "cash",
  creditCard: "creditCard",
  lineOfCredit: "lineOfCredit",
  mortgage: "mortgage",
  otherAsset: "tracking",
  otherLiability: "tracking",
  investmentAccount: "tracking",
  autoLoan: "tracking",
  studentLoan: "tracking",
  personalLoan: "tracking",
  medicalDebt: "tracking",
  otherDebt: "tracking",
};

// -- Conversion helpers --

export function mapAccount(a: YnabAccount): BudgetAccount {
  return {
    id: a.id,
    name: a.name,
    type: YNAB_ACCOUNT_TYPE_MAP[a.type] ?? "other",
    onBudget: a.on_budget,
    closed: a.closed,
    balance: fromMilliunits(a.balance),
    clearedBalance: fromMilliunits(a.cleared_balance),
    transferPayeeId: a.transfer_payee_id ?? undefined,
  };
}

function mapCategory(c: YnabCategory, groupName: string): BudgetCategory {
  return {
    id: c.id,
    name: c.name,
    groupId: c.category_group_id,
    groupName,
    hidden: c.hidden,
    budgeted: fromMilliunits(c.budgeted),
    activity: fromMilliunits(c.activity),
    balance: fromMilliunits(c.balance),
    goalTarget:
      c.goal_target != null ? fromMilliunits(c.goal_target) : undefined,
    goalType: c.goal_type ?? undefined,
    note: c.note ?? null,
  };
}

export function mapCategoryGroup(g: YnabCategoryGroup): BudgetCategoryGroup {
  return {
    id: g.id,
    name: g.name,
    hidden: g.hidden,
    // YNAB's income ("Inflow: Ready to Assign") sits in its internal group.
    isIncome: g.name === "Internal Master Category",
    categories: g.categories.map((c) => mapCategory(c, g.name)),
  };
}

export function mapMonth(m: YnabMonth): BudgetMonth {
  return {
    month: m.month,
    income: fromMilliunits(m.income),
    budgeted: fromMilliunits(m.budgeted),
    activity: fromMilliunits(m.activity),
    toBeBudgeted: fromMilliunits(m.to_be_budgeted),
  };
}

export function mapMonthDetail(
  m: YnabMonth & { categories: YnabCategory[] },
): BudgetMonthDetail {
  return {
    ...mapMonth(m),
    categories: m.categories
      .filter(
        (c) =>
          !c.category_group_name ||
          !YNAB_INTERNAL_GROUPS.has(c.category_group_name),
      )
      .map((c) => mapCategory(c, c.category_group_name ?? "")),
  };
}

export function mapTransaction(t: YnabTransaction): BudgetTransaction {
  return {
    id: t.id,
    accountId: t.account_id,
    accountName: t.account_name,
    date: t.date,
    amount: fromMilliunits(t.amount),
    payeeName: t.payee_name ?? null,
    categoryId: t.category_id ?? null,
    categoryName: t.category_name ?? null,
    memo: t.memo ?? null,
    cleared: t.cleared === "cleared" || t.cleared === "reconciled",
    approved: t.approved,
    deleted: t.deleted,
    ...(t.subtransactions.length && {
      subtransactions: t.subtransactions
        .filter((st) => !st.deleted)
        .map((st) => ({
          categoryId: st.category_id ?? null,
          categoryName: st.category_name ?? null,
          amount: fromMilliunits(st.amount),
          memo: st.memo ?? null,
        })),
    }),
  };
}
