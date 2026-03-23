/** Brokerage router for managing taxable investment goals, planned transactions, and allocation tracking. */
import { eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import {
  createTRPCRouter,
  protectedProcedure,
  brokerageProcedure,
} from "../trpc";
import * as schema from "@/lib/db/schema";
import { toNumber } from "@/server/helpers";

const plannedTransactionInput = z.object({
  goalId: z.number().int(),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.string().refine((v) => !isNaN(Number(v)) && v.trim() !== "", {
    message: "Must be a valid number",
  }),
  description: z.string().min(1),
  isRecurring: z.boolean().default(false),
  recurrenceMonths: z.number().int().nullable().optional(),
});

export const brokerageRouter = createTRPCRouter({
  // ══ GOALS ══

  listGoals: protectedProcedure.query(async ({ ctx }) => {
    const goals = await ctx.db
      .select()
      .from(schema.brokerageGoals)
      .where(eq(schema.brokerageGoals.isActive, true))
      .orderBy(
        asc(schema.brokerageGoals.targetYear),
        asc(schema.brokerageGoals.priority),
      );
    return goals.map((g) => ({
      id: g.id,
      name: g.name,
      targetAmount: toNumber(g.targetAmount),
      targetYear: g.targetYear,
      priority: g.priority,
      isActive: g.isActive,
      notes: g.notes,
    }));
  }),

  createGoal: brokerageProcedure
    .input(
      z.object({
        name: z.string().min(1),
        targetAmount: z
          .string()
          .refine((v) => !isNaN(Number(v)) && Number(v) > 0),
        targetYear: z.number().int().min(new Date().getFullYear()),
        priority: z.number().int().default(0),
        notes: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(schema.brokerageGoals)
        .values({
          name: input.name,
          targetAmount: input.targetAmount,
          targetYear: input.targetYear,
          priority: input.priority,
          notes: input.notes ?? null,
        })
        .returning();
      return row;
    }),

  updateGoal: brokerageProcedure
    .input(
      z.object({
        id: z.number().int(),
        name: z.string().min(1).optional(),
        targetAmount: z
          .string()
          .refine((v) => !isNaN(Number(v)) && Number(v) > 0)
          .optional(),
        targetYear: z.number().int().optional(),
        priority: z.number().int().optional(),
        isActive: z.boolean().optional(),
        notes: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;
      await ctx.db
        .update(schema.brokerageGoals)
        .set(updates)
        .where(eq(schema.brokerageGoals.id, id));
      return { ok: true };
    }),

  deleteGoal: brokerageProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(schema.brokerageGoals)
        .where(eq(schema.brokerageGoals.id, input.id));
      return { ok: true };
    }),

  // ══ SUMMARY (goals + planned transactions for brokerage page) ══

  computeSummary: protectedProcedure.query(async ({ ctx }) => {
    const [goals, plannedTransactions] = await Promise.all([
      ctx.db
        .select()
        .from(schema.brokerageGoals)
        .where(eq(schema.brokerageGoals.isActive, true))
        .orderBy(
          asc(schema.brokerageGoals.targetYear),
          asc(schema.brokerageGoals.priority),
        ),
      ctx.db
        .select()
        .from(schema.brokeragePlannedTransactions)
        .orderBy(asc(schema.brokeragePlannedTransactions.transactionDate)),
    ]);

    return {
      goals: goals.map((g) => ({
        id: g.id,
        name: g.name,
        targetAmount: toNumber(g.targetAmount),
        targetYear: g.targetYear,
        priority: g.priority,
        isActive: g.isActive,
        notes: g.notes,
      })),
      plannedTransactions: plannedTransactions.map((t) => ({
        id: t.id,
        goalId: t.goalId,
        transactionDate: t.transactionDate,
        amount: toNumber(t.amount),
        description: t.description,
        isRecurring: t.isRecurring,
        recurrenceMonths: t.recurrenceMonths,
      })),
    };
  }),

  // ══ PLANNED TRANSACTIONS ══

  plannedTransactions: createTRPCRouter({
    create: brokerageProcedure
      .input(plannedTransactionInput)
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.brokeragePlannedTransactions)
          .values(input)
          .returning()
          .then((r) => r[0]),
      ),
    update: brokerageProcedure
      .input(
        z
          .object({ id: z.number().int() })
          .extend(plannedTransactionInput.shape),
      )
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.brokeragePlannedTransactions)
          .set(data)
          .where(eq(schema.brokeragePlannedTransactions.id, id))
          .returning()
          .then((r) => r[0]),
      ),
    delete: brokerageProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.brokeragePlannedTransactions)
          .where(eq(schema.brokeragePlannedTransactions.id, input.id)),
      ),
  }),
});
