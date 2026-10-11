/**
 * The household's own transaction rules ("rows from <institution> described
 * like <text> are <kind>"), checked before the built-in institution rules.
 * portfolioProcedure throughout — rule text is transaction-level detail.
 */
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, portfolioProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import {
  amountSignSchema,
  investmentTransactionKindSchema,
} from "@/lib/config/enum-values";
import { previewRuleImpact } from "@/lib/pure/investment-transaction-rules";
import { accountRedactsCardSpending } from "@/lib/simplefin/ingest";
import { loadClassifiedTransactions, loadUserRules } from "./_shared";

const ruleInput = z.object({
  institutionContains: z.string().trim().min(1).max(100),
  descriptionContains: z.string().trim().min(1).max(200),
  sign: amountSignSchema.nullable().default(null),
  kind: investmentTransactionKindSchema,
  priority: z.number().int().min(-100).max(100).default(0),
});

type Db = typeof import("@/lib/db").db;

async function impactOf(db: Db, candidate: z.infer<typeof ruleInput>) {
  const existing = await loadUserRules(db);
  const rows = await loadClassifiedTransactions(db, {});
  return previewRuleImpact(
    { ...candidate, reviewWhen: null, maxFractionOfBalance: null },
    existing,
    rows.map((r) => ({
      institution: r.institution,
      accountBalance: r.balanceForRules,
      amount: r.rawAmount,
      description: r.description,
      kindOverride: r.kindOverride,
      kindOverrideSource: r.kindOverrideSource,
    })),
  );
}

export const investmentRulesRouter = createTRPCRouter({
  /** The household's rules, highest priority first. */
  listRules: portfolioProcedure.query(async ({ ctx }) => {
    const rules = await loadUserRules(ctx.db);
    return rules.sort((a, b) => b.priority - a.priority || a.id - b.id);
  }),

  /** How many stored rows a rule would match and reclassify, before saving it. */
  previewRule: portfolioProcedure
    .input(ruleInput)
    .query(async ({ ctx, input }) => impactOf(ctx.db, input)),

  /** Save a rule. `fromTransactionId` records the row it was made from. */
  createRule: portfolioProcedure
    .input(ruleInput.extend({ fromTransactionId: z.number().int().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { fromTransactionId, ...rule } = input;
      let sampleDescription: string | null = null;
      if (fromTransactionId !== undefined) {
        const [row] = await ctx.db
          .select()
          .from(schema.investmentTransactions)
          .where(eq(schema.investmentTransactions.id, fromTransactionId));
        if (!row) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Transaction not found",
          });
        }
        // Don't copy text from accounts whose card spending is redacted —
        // it may name a merchant (health data).
        if (!(await accountRedactsCardSpending(ctx.db, row.simplefinAccountId)))
          sampleDescription = row.description;
      }
      const impact = await impactOf(ctx.db, rule);
      const [saved] = await ctx.db
        .insert(schema.investmentTransactionRules)
        .values({ ...rule, sampleDescription })
        .returning();
      return { rule: saved!, ...impact };
    }),

  /** Delete a rule; rows it matched go back to the built-in rules. */
  deleteRule: portfolioProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(schema.investmentTransactionRules)
        .where(eq(schema.investmentTransactionRules.id, input.id));
      return { ok: true as const };
    }),
});
