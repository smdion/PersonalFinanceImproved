/**
 * Investment transactions: read with their kind, and the review queue's
 * per-row choices.
 *
 * Everything here uses portfolioProcedure: a row's kind changes what the
 * portfolio numbers mean, so whoever can see the rows decides them — never
 * someone who can't read them.
 */
import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, portfolioProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { investmentTransactionKindSchema } from "@/lib/config/enum-values";
import { lockAsMedicalWithdrawal } from "@/lib/simplefin/ingest";
import { localDateStr } from "@/lib/utils/date";
import {
  loadAccounts,
  loadClassifiedTransactions,
  type ClassifiedTransactionRow,
} from "./_shared";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The balance used for rules stays on the server. */
function forClient({
  balanceForRules: _balance,
  ...row
}: ClassifiedTransactionRow) {
  return row;
}

export const investmentTransactionsRouter = createTRPCRouter({
  /** Investment transactions with the kind each counts as, newest first. */
  listTransactions: portfolioProcedure
    .input(
      z.object({
        simplefinAccountId: z.number().int().optional(),
        days: z.number().int().min(1).max(3660).default(90),
        includeVoided: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await loadClassifiedTransactions(ctx.db, {
        simplefinAccountId: input.simplefinAccountId,
        since: localDateStr(new Date(Date.now() - input.days * DAY_MS)),
        includeVoided: input.includeVoided,
      });
      return rows.map(forClient);
    }),

  /** Set the kind of one row. Redacted HSA rows are fixed and can't be changed. */
  setTransactionKind: portfolioProcedure
    .input(
      z.object({ id: z.number().int(), kind: investmentTransactionKindSchema }),
    )
    .mutation(async ({ ctx, input }) => {
      const t = schema.investmentTransactions;
      const [row] = await ctx.db.select().from(t).where(eq(t.id, input.id));
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Transaction not found",
        });
      }
      if (row.kindOverrideSource === "ingest_redacted") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Medical withdrawals are fixed and can't be changed.",
        });
      }
      // Money taken out of an HSA is shown like card spending: amount only.
      const account = (await loadAccounts(ctx.db)).get(row.simplefinAccountId);
      if (
        input.kind === "withdrawal" &&
        Number(row.amount) < 0 &&
        account?.isHsa
      ) {
        await lockAsMedicalWithdrawal(ctx.db, [row.id]);
        return { id: row.id, kind: input.kind, redacted: true };
      }
      await ctx.db
        .update(t)
        .set({
          kindOverride: input.kind,
          kindOverrideSource: "user",
          updatedAt: new Date(),
        })
        .where(eq(t.id, row.id));
      return { id: row.id, kind: input.kind, redacted: false };
    }),

  /** Undo a choice made in the review queue (never the redaction lock). */
  clearTransactionKind: portfolioProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const t = schema.investmentTransactions;
      const cleared = await ctx.db
        .update(t)
        .set({
          kindOverride: null,
          kindOverrideSource: null,
          updatedAt: new Date(),
        })
        .where(and(eq(t.id, input.id), eq(t.kindOverrideSource, "user")))
        .returning({ id: t.id });
      return { cleared: cleared.length > 0 };
    }),
});
