/** The budget apps' cached data (budget_api_cache.data) by key, as the
 *  clients write it; `cacheGet` checks a read against its key's shape. */
import { z } from "zod/v4";
import type {
  BudgetAccount,
  BudgetCategory,
  BudgetCategoryGroup,
  BudgetMonthDetail,
  BudgetTransaction,
} from "./types";

const budgetCategoryShape: z.ZodType<BudgetCategory> = z.object({
  id: z.string(),
  name: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  hidden: z.boolean(),
  budgeted: z.number(),
  activity: z.number(),
  balance: z.number(),
  goalTarget: z.number().optional(),
  goalType: z.string().optional(),
  note: z.string().nullable().optional(),
});

const cachedAccountsShape: z.ZodType<BudgetAccount[]> = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    type: z.enum([
      "checking",
      "savings",
      "cash",
      "creditCard",
      "lineOfCredit",
      "mortgage",
      "tracking",
      "other",
    ]),
    onBudget: z.boolean(),
    closed: z.boolean(),
    balance: z.number(),
    clearedBalance: z.number(),
    transferPayeeId: z.string().optional(),
  }),
);

const cachedCategoriesShape: z.ZodType<BudgetCategoryGroup[]> = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    hidden: z.boolean(),
    isIncome: z.boolean(),
    categories: z.array(budgetCategoryShape),
  }),
);

const cachedMonthShape: z.ZodType<BudgetMonthDetail> = z.object({
  month: z.string(),
  income: z.number(),
  budgeted: z.number(),
  activity: z.number(),
  toBeBudgeted: z.number().nullable(),
  categories: z.array(budgetCategoryShape),
});

const cachedTransactionsShape: z.ZodType<BudgetTransaction[]> = z.array(
  z.object({
    id: z.string(),
    accountId: z.string(),
    accountName: z.string(),
    date: z.string(),
    amount: z.number(),
    payeeName: z.string().nullable(),
    categoryId: z.string().nullable(),
    categoryName: z.string().nullable(),
    memo: z.string().nullable(),
    cleared: z.boolean(),
    approved: z.boolean(),
    deleted: z.boolean(),
    subtransactions: z
      .array(
        z.object({
          categoryId: z.string().nullable(),
          categoryName: z.string().nullable(),
          amount: z.number(),
          memo: z.string().nullable(),
        }),
      )
      .optional(),
  }),
);

/** A cache key the app reads: one per kind of data, a month by its first day. */
export type CacheKey =
  "accounts" | "categories" | "transactions" | `months/${string}`;

/** The shape the data under `key` is written in. */
export function cachedShapeFor(key: CacheKey): z.ZodType {
  if (key === "accounts") return cachedAccountsShape;
  if (key === "categories") return cachedCategoriesShape;
  if (key === "transactions") return cachedTransactionsShape;
  return cachedMonthShape;
}
