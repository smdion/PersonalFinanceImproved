/** Every actual-http-api response Ledgr reads, checked before use: only
 *  the fields Ledgr reads are required, anything else passes. Money is
 *  integer cents. */
import { z } from "zod/v4";

const cents = z.number().int();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const account = z.looseObject({
  id: z.string(),
  name: z.string(),
  offbudget: z.boolean(),
  closed: z.boolean(),
});

/** `/categories`: names only; the numbers come from the month. */
const category = z.looseObject({
  id: z.string(),
  name: z.string(),
  group_id: z.string(),
  hidden: z.boolean(),
});

const categoryGroup = z.looseObject({
  id: z.string(),
  name: z.string(),
  is_income: z.boolean(),
  hidden: z.boolean(),
});

/** A month's spending category carries budgeted, spent and balance; an
 *  income category carries only `received` (absent is a state). */
const monthCategory = z.discriminatedUnion("is_income", [
  category.extend({
    is_income: z.literal(false),
    budgeted: cents,
    spent: cents,
    balance: cents,
  }),
  category.extend({ is_income: z.literal(true), received: cents }),
]);

const month = z.looseObject({
  month: z.string(),
  totalIncome: cents,
  totalBudgeted: cents,
  totalSpent: cents,
  /** A tracking budget has none. */
  toBudget: cents.nullable(),
  categoryGroups: z.array(
    categoryGroup.extend({ categories: z.array(monthCategory) }),
  ),
});

/** `/payees`: a transfer payee may have an empty name and points at its
 *  account instead. */
const payee = z.looseObject({
  id: z.string(),
  name: z.string(),
  transfer_acct: z.string().nullish(),
});

const transaction = z.looseObject({
  id: z.string(),
  account: z.string(),
  date: isoDate,
  amount: cents,
  /** Ids only: the wrapper sends no account, payee or category names, so
   *  the client resolves them from `/accounts`, `/payees` and `/categories`. */
  payee: z.string().nullish(),
  category: z.string().nullish(),
  notes: z.string().nullish(),
  imported_id: z.string().nullish(),
  cleared: z.boolean(),
  reconciled: z.boolean(),
  /** `[]` unless it's a split; a deleted part has `tombstone`. */
  subtransactions: z.array(
    z.looseObject({
      amount: cents,
      category: z.string().nullish(),
      notes: z.string().nullish(),
      tombstone: z.boolean(),
    }),
  ),
});

export const actualSchemas = {
  accounts: z.looseObject({ data: z.array(account) }),
  balance: z.looseObject({ data: cents }),
  categoryGroups: z.looseObject({ data: z.array(categoryGroup) }),
  categories: z.looseObject({ data: z.array(category) }),
  monthIds: z.looseObject({ data: z.array(z.string()) }),
  month: z.looseObject({ data: month }),
  /** No note answers `""`. */
  note: z.looseObject({ data: z.string() }),
  payees: z.looseObject({ data: z.array(payee) }),
  transactions: z.looseObject({ data: z.array(transaction) }),
  /** Ledgr reads nothing from a write's answer. */
  written: z.unknown(),
};

export type ActualAccount = z.infer<typeof account>;
export type ActualCategoryGroup = z.infer<typeof categoryGroup>;
export type ActualMonth = z.infer<typeof month>;
export type ActualPayee = z.infer<typeof payee>;
export type ActualTransaction = z.infer<typeof transaction>;
