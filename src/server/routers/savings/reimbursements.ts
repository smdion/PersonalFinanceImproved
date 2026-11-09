import { eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import { protectedProcedure, savingsProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import {
  loadSavingsGoalLinks,
  setSavingsGoalLink,
  deleteSavingsGoalLink,
} from "@/server/data/category-links";
import { budgetApiServiceSchema } from "@/lib/config/enum-values.schema";
import { getActiveBudgetApi, cacheGet } from "@/lib/budget-api";

export const reimbursementProcedures = {
  // ══ REIMBURSEMENT CATEGORY ══

  /** Link a reimbursement tracking category to the e-fund goal. */
  linkReimbursementCategory: savingsProcedure
    .input(
      z.object({
        goalId: z.number().int(),
        service: budgetApiServiceSchema,
        apiCategoryId: z.string().min(1).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.apiCategoryId === null) {
        await deleteSavingsGoalLink(ctx.db, {
          savingsGoalId: input.goalId,
          service: input.service,
          role: "reimbursement",
        });
      } else {
        await setSavingsGoalLink(ctx.db, {
          savingsGoalId: input.goalId,
          service: input.service,
          role: "reimbursement",
          categoryId: input.apiCategoryId,
        });
      }
      return { ok: true };
    }),

  /** Get parsed reimbursement items from the linked YNAB category's note field. */
  listEfundReimbursements: protectedProcedure.query(async ({ ctx }) => {
    const active = await getActiveBudgetApi(ctx.db);
    if (active === "none") return null;

    // Find the e-fund goal with a linked reimbursement category
    // The active e-fund goal, as the overview finds it: a deactivated
    // e-fund goal with an older id must not be the one read.
    const goals = await ctx.db
      .select()
      .from(schema.savingsGoals)
      .where(eq(schema.savingsGoals.isActive, true))
      .orderBy(asc(schema.savingsGoals.id));
    const efundGoalCandidate = goals.find((g) => g.isEmergencyFund);
    if (!efundGoalCandidate) return null;
    const reimbursementLinks = await loadSavingsGoalLinks(
      ctx.db,
      [efundGoalCandidate.id],
      active,
      "reimbursement",
    );
    const reimbursementCategoryId = reimbursementLinks.get(
      efundGoalCandidate.id,
    )?.categoryId;
    if (!reimbursementCategoryId) return null;
    const efundGoal = {
      ...efundGoalCandidate,
      reimbursementApiCategoryId: reimbursementCategoryId,
    };

    const categoriesCache = await cacheGet(ctx.db, active, "categories");
    if (!categoriesCache) return null;

    // Find the reimbursement category in cache
    let reimbursementCat: {
      name: string;
      note?: string | null;
      balance: number;
      goalTarget?: number;
    } | null = null;
    for (const group of categoriesCache.data) {
      for (const cat of group.categories) {
        if (cat.id === efundGoal.reimbursementApiCategoryId) {
          reimbursementCat = cat;
          break;
        }
      }
      if (reimbursementCat) break;
    }
    if (!reimbursementCat) return null;

    // Parse note field: each line = "amount - description"
    // Supports: "50 - lunch", "1,200 — hotel", "$50.00 - taxi"
    const items: { amount: number; description: string }[] = [];
    const skippedLines: string[] = [];
    if (reimbursementCat.note) {
      for (const line of reimbursementCat.note.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const match = trimmed.match(/^\$?([\d,.]+)\s*[-–—]\s*(.+)$/);
        if (match) {
          const amount = parseFloat(match[1]!.replace(/,/g, ""));
          if (!isNaN(amount) && amount > 0) {
            items.push({ amount, description: match[2]!.trim() });
          } else {
            skippedLines.push(trimmed);
          }
        } else {
          skippedLines.push(trimmed);
        }
      }
    }

    const total = items.reduce((s, i) => s + i.amount, 0);

    return {
      items,
      total,
      balance: reimbursementCat.balance,
      target: reimbursementCat.goalTarget ?? 0,
      categoryName: reimbursementCat.name,
      skippedLines: skippedLines.length > 0 ? skippedLines : undefined,
    };
  }),
};
