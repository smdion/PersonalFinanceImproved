import { eq, and, ne } from "drizzle-orm";
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  savingsProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { loadSavingsGoalLinks } from "@/server/data/category-links";
import { zCalendarDate, zDecimal } from "@/lib/utils/zod-fields";
import { getActiveBudgetApi, cacheGet } from "@/lib/budget-api";
import type { BudgetTransaction } from "@/lib/budget-api";
import type { DbOrTx } from "@/lib/db";

/** A transfer's two legs must settle/unsettle together — otherwise money
 *  silently vanishes from (or reappears in) the combined projection. */
async function resolvePairedPlannedTxIds(
  db: DbOrTx,
  plannedTxId: number,
): Promise<number[]> {
  const [row] = await db
    .select({
      transferPairId: schema.savingsPlannedTransactions.transferPairId,
    })
    .from(schema.savingsPlannedTransactions)
    .where(eq(schema.savingsPlannedTransactions.id, plannedTxId));
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Planned transaction not found",
    });
  }
  if (!row.transferPairId) return [plannedTxId];
  const pairRows = await db
    .select({ id: schema.savingsPlannedTransactions.id })
    .from(schema.savingsPlannedTransactions)
    .where(
      eq(schema.savingsPlannedTransactions.transferPairId, row.transferPairId),
    );
  return pairRows.map((r) => r.id);
}

async function settleOccurrence(
  db: DbOrTx,
  input: { plannedTxId: number; occurrenceMonth: string },
) {
  const pairIds = await resolvePairedPlannedTxIds(db, input.plannedTxId);
  const monthDate = `${input.occurrenceMonth}-01`;
  const existing = await db
    .select({ id: schema.savingsPlannedTxSettlements.id })
    .from(schema.savingsPlannedTxSettlements)
    .where(
      and(
        eq(schema.savingsPlannedTxSettlements.plannedTxId, input.plannedTxId),
        eq(schema.savingsPlannedTxSettlements.occurrenceMonth, monthDate),
      ),
    );
  if (existing.length > 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Already settled." });
  }
  await db.insert(schema.savingsPlannedTxSettlements).values(
    pairIds.map((id) => ({
      plannedTxId: id,
      occurrenceMonth: monthDate,
    })),
  );
  return { ok: true };
}

const plannedTransactionInput = z.object({
  goalId: z.number().int(),
  transactionDate: zCalendarDate,
  amount: zDecimal, // positive = deposit, negative = withdrawal
  description: z.string().min(1),
  isRecurring: z.boolean().default(false),
  recurrenceMonths: z.number().int().min(1).nullable().optional(),
});

export const plannedTransactionProcedures = {
  // ══ PLANNED TRANSACTIONS ══
  plannedTransactions: createTRPCRouter({
    create: savingsProcedure
      .input(plannedTransactionInput)
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.savingsPlannedTransactions)
          .values(input)
          .returning()
          .then((r) => r[0]),
      ),
    update: savingsProcedure
      .input(
        z
          .object({ id: z.number().int() })
          .extend(plannedTransactionInput.shape),
      )
      .mutation(async ({ ctx, input: { id, ...data } }) => {
        const [row] = await ctx.db
          .select({
            source: schema.savingsPlannedTransactions.source,
            transferPairId: schema.savingsPlannedTransactions.transferPairId,
          })
          .from(schema.savingsPlannedTransactions)
          .where(eq(schema.savingsPlannedTransactions.id, id));
        if (row?.source === "rule") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Auto-generated transactions cannot be edited. Manage them via the Extra Paychecks tab.",
          });
        }
        return ctx.db.transaction(async (tx) => {
          const updated = await tx
            .update(schema.savingsPlannedTransactions)
            .set(data)
            .where(
              and(
                eq(schema.savingsPlannedTransactions.id, id),
                eq(schema.savingsPlannedTransactions.source, "manual"),
              ),
            )
            .returning()
            .then((r) => r[0]);
          // A transfer's two legs move together: the other leg takes the
          // same date, description and recurrence, and the mirrored amount.
          if (row?.transferPairId) {
            const [other] = await tx
              .select({
                id: schema.savingsPlannedTransactions.id,
                goalId: schema.savingsPlannedTransactions.goalId,
              })
              .from(schema.savingsPlannedTransactions)
              .where(
                and(
                  eq(
                    schema.savingsPlannedTransactions.transferPairId,
                    row.transferPairId,
                  ),
                  ne(schema.savingsPlannedTransactions.id, id),
                ),
              );
            if (other) {
              if (other.goalId === data.goalId)
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "A transfer can't go to the fund it comes from",
                });
              await tx
                .update(schema.savingsPlannedTransactions)
                .set({
                  transactionDate: data.transactionDate,
                  description: data.description,
                  isRecurring: data.isRecurring,
                  recurrenceMonths: data.recurrenceMonths ?? null,
                  amount: String(-Number(data.amount)),
                })
                .where(eq(schema.savingsPlannedTransactions.id, other.id));
            }
          }
          return updated;
        });
      }),
    delete: savingsProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .select({
            source: schema.savingsPlannedTransactions.source,
            transferPairId: schema.savingsPlannedTransactions.transferPairId,
          })
          .from(schema.savingsPlannedTransactions)
          .where(eq(schema.savingsPlannedTransactions.id, input.id));
        if (row?.source === "rule") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Auto-generated transactions cannot be deleted. Manage them via the Extra Paychecks tab.",
          });
        }
        // Half a transfer is money from nowhere: both legs go.
        if (row?.transferPairId)
          return ctx.db
            .delete(schema.savingsPlannedTransactions)
            .where(
              eq(
                schema.savingsPlannedTransactions.transferPairId,
                row.transferPairId,
              ),
            );
        return ctx.db
          .delete(schema.savingsPlannedTransactions)
          .where(
            and(
              eq(schema.savingsPlannedTransactions.id, input.id),
              eq(schema.savingsPlannedTransactions.source, "manual"),
            ),
          );
      }),
    // Settlement is per-occurrence (plannedTxId + occurrenceMonth), never
    // per-row — a recurring row has many future occurrences, and settling
    // one must not hide the others from the projection. Never invoked
    // automatically (e.g. from sync); always an explicit user action.
    settle: savingsProcedure
      .input(
        z.object({
          plannedTxId: z.number().int(),
          occurrenceMonth: z.string().regex(/^\d{4}-\d{2}$/),
        }),
      )
      .mutation(({ ctx, input }) => settleOccurrence(ctx.db, input)),
    settleMany: savingsProcedure
      .input(
        z.object({
          occurrences: z.array(
            z.object({
              plannedTxId: z.number().int(),
              occurrenceMonth: z.string().regex(/^\d{4}-\d{2}$/),
            }),
          ),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        return ctx.db.transaction(async (tx) => {
          // Settling one leg of a transfer settles both, so the other leg in
          // the same request is already done.
          const done = new Set<string>();
          for (const occ of input.occurrences) {
            if (done.has(`${occ.plannedTxId}:${occ.occurrenceMonth}`)) continue;
            await settleOccurrence(tx, occ);
            for (const id of await resolvePairedPlannedTxIds(
              tx,
              occ.plannedTxId,
            ))
              done.add(`${id}:${occ.occurrenceMonth}`);
          }
          return { ok: true };
        });
      }),
    // Presence-based hint only — never a write. A trip is many small real
    // charges that never cleanly sum to one planned placeholder amount, so
    // this deliberately doesn't try to match dollar amounts: once ANY real
    // transaction posts in the goal's linked category on/after the planned
    // date, in the same month, the live balance already reflects it and the
    // placeholder's forecasting job is done. Surfaced as a dismissible
    // suggestion the user confirms — settlement itself only ever happens via
    // the settle/settleMany mutations above.
    getSettlementSuggestions: protectedProcedure.query(async ({ ctx }) => {
      const active = await getActiveBudgetApi(ctx.db);
      if (active === "none") return { suggestions: [] };

      const transactionsCache = await cacheGet<BudgetTransaction[]>(
        ctx.db,
        active,
        "transactions",
      );
      if (!transactionsCache) return { suggestions: [] };
      const realTransactions = transactionsCache.data;

      const [rows, settlements, goals] = await Promise.all([
        ctx.db
          .select({
            id: schema.savingsPlannedTransactions.id,
            goalId: schema.savingsPlannedTransactions.goalId,
            transactionDate: schema.savingsPlannedTransactions.transactionDate,
          })
          .from(schema.savingsPlannedTransactions),
        ctx.db
          .select({
            plannedTxId: schema.savingsPlannedTxSettlements.plannedTxId,
            occurrenceMonth: schema.savingsPlannedTxSettlements.occurrenceMonth,
          })
          .from(schema.savingsPlannedTxSettlements),
        ctx.db.select({ id: schema.savingsGoals.id }).from(schema.savingsGoals),
      ]);

      const settledSet = new Set(
        settlements.map(
          (s) => `${s.plannedTxId}:${s.occurrenceMonth.slice(0, 7)}`,
        ),
      );
      const settlementGoalLinks = await loadSavingsGoalLinks(
        ctx.db,
        goals.map((g) => g.id),
        active,
        "primary",
      );
      const apiCategoryByGoal = new Map(
        [...settlementGoalLinks.entries()].map(([goalId, link]) => [
          goalId,
          link.categoryId,
        ]),
      );

      // Real transactions grouped by category + month ("YYYY-MM"), keeping
      // only the earliest date per group (the check is "is there activity
      // on/after the planned date", so the earliest is the strictest test).
      const realByCategoryMonth = new Map<string, string>();
      for (const t of realTransactions) {
        if (t.deleted || !t.categoryId) continue;
        const month = t.date.slice(0, 7);
        const key = `${t.categoryId}:${month}`;
        const existing = realByCategoryMonth.get(key);
        if (!existing || t.date < existing) {
          realByCategoryMonth.set(key, t.date);
        }
      }

      const suggestions: { plannedTxId: number; occurrenceMonth: string }[] =
        [];
      for (const row of rows) {
        const categoryId = apiCategoryByGoal.get(row.goalId);
        if (!categoryId) continue;
        // v1 scope: only the row's own occurrence, not every future
        // occurrence of a recurring row — a future occurrence can't have a
        // matching real transaction yet anyway.
        const occurrenceMonth = row.transactionDate.slice(0, 7);
        if (settledSet.has(`${row.id}:${occurrenceMonth}`)) continue;
        const earliestReal = realByCategoryMonth.get(
          `${categoryId}:${occurrenceMonth}`,
        );
        if (earliestReal && earliestReal >= row.transactionDate) {
          suggestions.push({ plannedTxId: row.id, occurrenceMonth });
        }
      }
      return { suggestions };
    }),
  }),
};
