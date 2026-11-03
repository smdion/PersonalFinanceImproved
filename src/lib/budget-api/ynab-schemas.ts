/** Every YNAB API response Ledgr reads, checked before use, as the
 *  `/budgets` paths send them (YNAB API spec 1.88.0's objects). Only the
 *  fields Ledgr reads are required; money is integer milliunits. */
import { z } from "zod/v4";

const milliunits = z.number().int();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const account = z.looseObject({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  on_budget: z.boolean(),
  closed: z.boolean(),
  balance: milliunits,
  cleared_balance: milliunits,
  transfer_payee_id: z.string().nullish(),
});

const category = z.looseObject({
  id: z.string(),
  name: z.string(),
  category_group_id: z.string(),
  /** Sent by a month's categories, not the category list. */
  category_group_name: z.string().optional(),
  hidden: z.boolean(),
  budgeted: milliunits,
  activity: milliunits,
  balance: milliunits,
  /** A category with no target has none of these. */
  goal_target: milliunits.nullish(),
  goal_type: z.string().nullish(),
  goal_cadence: z.number().int().nullish(),
  goal_cadence_frequency: z.number().int().nullish(),
  note: z.string().nullish(),
});

const categoryGroup = z.looseObject({
  id: z.string(),
  name: z.string(),
  hidden: z.boolean(),
  categories: z.array(category),
});

const monthSummary = z.looseObject({
  month: isoDate,
  income: milliunits,
  budgeted: milliunits,
  activity: milliunits,
  to_be_budgeted: milliunits,
});

const transaction = z.looseObject({
  id: z.string(),
  account_id: z.string(),
  account_name: z.string(),
  date: isoDate,
  amount: milliunits,
  payee_name: z.string().nullish(),
  category_id: z.string().nullish(),
  category_name: z.string().nullish(),
  memo: z.string().nullish(),
  /** "cleared", "uncleared" or "reconciled". */
  cleared: z.string(),
  approved: z.boolean(),
  deleted: z.boolean(),
  import_id: z.string().nullish(),
  subtransactions: z.array(
    z.looseObject({
      amount: milliunits,
      memo: z.string().nullish(),
      category_id: z.string().nullish(),
      category_name: z.string().nullish(),
      deleted: z.boolean(),
    }),
  ),
});

const data = <T extends z.ZodRawShape>(shape: T) =>
  z.looseObject({ data: z.looseObject(shape) });

export const ynabSchemas = {
  budgets: data({
    budgets: z.array(z.looseObject({ id: z.string(), name: z.string() })),
  }),
  accounts: data({ accounts: z.array(account) }),
  account: data({ account }),
  categories: data({ category_groups: z.array(categoryGroup) }),
  category: data({ category }),
  months: data({ months: z.array(monthSummary) }),
  month: data({
    month: monthSummary.extend({ categories: z.array(category) }),
  }),
  transactions: data({ transactions: z.array(transaction) }),
  /** A duplicate import_id comes back without `transaction`. */
  created: data({
    transaction: z.looseObject({ id: z.string() }).optional(),
  }),
  /** Ledgr reads nothing from these answers. */
  written: z.unknown(),
};

export type YnabAccount = z.infer<typeof account>;
export type YnabCategory = z.infer<typeof category>;
export type YnabCategoryGroup = z.infer<typeof categoryGroup>;
export type YnabMonth = z.infer<typeof monthSummary>;
export type YnabTransaction = z.infer<typeof transaction>;
