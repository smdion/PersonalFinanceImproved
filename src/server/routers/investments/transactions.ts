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

  /** Rows no rule could place, or that a rule flags for a look. */
  listReviewQueue: portfolioProcedure.query(async ({ ctx }) => {
    const rows = await loadClassifiedTransactions(ctx.db, {});
    return rows.filter((r) => r.needsReview).map(forClient);
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
          // A split only means something on a deposit.
          ...(input.kind === "contribution" ? {} : { sourceSplit: null }),
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

  /**
   * Split one deposit by hand — how much was the employer's and how much the
   * employee's Roth money (feeds report one amount; fills otherwise estimate
   * it from the paycheck setup). Null clears it.
   */
  setTransactionSplit: portfolioProcedure
    .input(
      z.object({
        id: z.number().int(),
        split: z
          .object({
            employer: z.number().min(0),
            employeeRoth: z.number().min(0),
          })
          .nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const t = schema.investmentTransactions;
      const [raw] = await ctx.db.select().from(t).where(eq(t.id, input.id));
      if (!raw)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Transaction not found",
        });
      if (input.split) {
        // Judge against the amount the row counts as (sign fixes applied).
        const row = (
          await loadClassifiedTransactions(ctx.db, {
            simplefinAccountId: raw.simplefinAccountId,
            since: raw.posted,
            includeVoided: true,
          })
        ).find((r) => r.id === raw.id);
        if (!row || row.kind !== "contribution" || row.amount <= 0)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only a deposit can be split.",
          });
        if (row.pending)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Wait until the deposit settles — a pending row often comes back as a new one.",
          });
        const { employer, employeeRoth } = input.split;
        if (employer + employeeRoth > row.amount + 0.005)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The parts can't add up to more than the deposit.",
          });
      }
      await ctx.db
        .update(t)
        .set({
          sourceSplit: input.split
            ? {
                employer: Math.round(input.split.employer * 100) / 100,
                employeeRoth: Math.round(input.split.employeeRoth * 100) / 100,
              }
            : null,
          updatedAt: new Date(),
        })
        .where(eq(t.id, raw.id));
      return { id: raw.id, split: input.split };
    }),
});
