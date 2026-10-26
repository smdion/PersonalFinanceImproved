/** Debts other than the mortgage (Liabilities page): list with payoff estimates, admin edits, and the other-liabilities summary. */
import { asc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import { toNumber } from "@/server/helpers";
import { zDecimal, debtKindSchema } from "@/lib/config/enum-values";
import { isCalendarDate, localDateStr } from "@/lib/utils/date";
import { debtPayoffEstimate } from "@/lib/pure/debts";
import {
  getEffectiveOtherLiabilities,
  isOpenDebt,
} from "@/server/helpers/debts";

const zDate = z.string().refine(isCalendarDate, "Not a date (YYYY-MM-DD)");
/** Annual rate as a fraction: 0 ≤ r < 1 (6.5% is 0.065, not 6.5). */
const zRate = zDecimal.refine((v) => Number(v) >= 0 && Number(v) < 1, {
  message: "Enter the rate as a fraction (6.5% is 0.065)",
});
const zMoney = zDecimal.refine((v) => Number(v) >= 0, {
  message: "Must be zero or more",
});

const debtFields = {
  name: z.string().trim().min(1),
  kind: debtKindSchema,
  ownerPersonId: z.number().int().positive().nullable(),
  balance: zMoney,
  balanceAsOf: zDate,
  originalAmount: zMoney.nullable().optional(),
  interestRate: zRate.nullable().optional(),
  monthlyPayment: zMoney.nullable().optional(),
  openedDate: zDate.nullable().optional(),
  paidOffDate: zDate.nullable().optional(),
  notes: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
};

export const debtsRouter = createTRPCRouter({
  /** Every debt (open first), with its payoff estimate. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(schema.debts)
      .orderBy(asc(schema.debts.sortOrder), asc(schema.debts.id));
    const today = localDateStr();
    return rows.map((d) => {
      const row = {
        ...d,
        balance: toNumber(d.balance),
        originalAmount:
          d.originalAmount == null ? null : toNumber(d.originalAmount),
        interestRate: d.interestRate == null ? null : toNumber(d.interestRate),
        monthlyPayment:
          d.monthlyPayment == null ? null : toNumber(d.monthlyPayment),
        open: isOpenDebt(d, today),
      };
      return { ...row, ...debtPayoffEstimate(row, today) };
    });
  }),

  /** Other liabilities and its parts — the same figure net worth uses. */
  summary: protectedProcedure.query(async ({ ctx }) => {
    const { manual, itemized, creditCardMapped, total } =
      await getEffectiveOtherLiabilities(ctx.db);
    return { manual, itemized, creditCardMapped, total };
  }),

  create: adminProcedure
    .input(z.object(debtFields))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(schema.debts)
        .values({
          ...input,
          originalAmount: input.originalAmount ?? null,
          interestRate: input.interestRate ?? null,
          monthlyPayment: input.monthlyPayment ?? null,
          openedDate: input.openedDate ?? null,
          paidOffDate: input.paidOffDate ?? null,
          notes: input.notes ?? null,
        })
        .returning();
      return row;
    }),

  update: adminProcedure
    .input(
      z
        .object(debtFields)
        .partial()
        .extend({ id: z.number().int().positive() }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      const set = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined),
      );
      if (Object.keys(set).length)
        await ctx.db
          .update(schema.debts)
          .set(set)
          .where(eq(schema.debts.id, id));
      return { success: true };
    }),

  // Only the date changes: the last balance stays as history (and as the
  // balance again if the payoff date is cleared) — the paid-off date alone
  // takes it out of every open total.
  /** Paid off on `date`, keeping its last balance. */
  markPaidOff: adminProcedure
    .input(z.object({ id: z.number().int().positive(), date: zDate }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.debts)
        .set({ paidOffDate: input.date })
        .where(eq(schema.debts.id, input.id));
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(schema.debts).where(eq(schema.debts.id, input.id));
      return { success: true };
    }),
});
