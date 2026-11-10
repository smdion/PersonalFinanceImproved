import type { Db } from "@/lib/db";
import type { BudgetApiService } from "@/lib/config/budget-apps";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { cacheGet } from "@/lib/budget-api";
import {
  loadBudgetItemLinks,
  setBudgetItemLink,
  loadSavingsGoalLinks,
  setSavingsGoalLink,
} from "@/server/data/category-links";

export async function syncAllNames(
  ctx: { db: Db },
  input: {
    service: BudgetApiService;
    direction: "pull" | "keepLedgr";
    includeCategories: boolean;
  },
) {
  let budgetRenamed = 0;
  let savingsRenamed = 0;
  let categoriesMoved = 0;

  const service = input.service;

  // Budget items with a link for this service
  const allBudgetItemRows = await ctx.db
    .select({
      id: schema.budgetItems.id,
      category: schema.budgetItems.category,
      subcategory: schema.budgetItems.subcategory,
    })
    .from(schema.budgetItems);
  const budgetItemLinks = await loadBudgetItemLinks(
    ctx.db,
    allBudgetItemRows.map((i) => i.id),
    service,
  );
  const allBudgetItems = allBudgetItemRows
    .map((i) => {
      const link = budgetItemLinks.get(i.id);
      return {
        ...i,
        apiCategoryId: link?.categoryId ?? null,
        apiCategoryName: link?.categoryName ?? null,
      };
    })
    .filter((i) => i.apiCategoryId);

  // Look up API category groups from cache for name + group resolution
  const apiCategoryMap = new Map<string, { name: string; groupName: string }>();
  if (input.direction === "pull") {
    {
      const cached = await cacheGet(ctx.db, service, "categories");
      if (cached) {
        for (const group of cached.data) {
          for (const cat of group.categories) {
            apiCategoryMap.set(cat.id, {
              name: cat.name,
              groupName: group.name,
            });
          }
        }
      }
    }
  }

  for (const item of allBudgetItems) {
    const updates: { subcategory?: string; category?: string } = {};
    let newApiCategoryName: string | null = null;

    // For pull: use the current API name from cache (if available), not stored name
    const currentApiName =
      (item.apiCategoryId
        ? apiCategoryMap.get(item.apiCategoryId)?.name
        : null) ?? item.apiCategoryName;

    // Name drift
    if (currentApiName && item.subcategory !== currentApiName) {
      if (input.direction === "pull") {
        updates.subcategory = currentApiName;
        newApiCategoryName = currentApiName;
      } else {
        newApiCategoryName = item.subcategory;
      }
      budgetRenamed++;
    }

    // Category group drift (pull only)
    if (
      input.direction === "pull" &&
      input.includeCategories &&
      item.apiCategoryId
    ) {
      const apiCat = apiCategoryMap.get(item.apiCategoryId);
      if (apiCat && apiCat.groupName !== item.category) {
        updates.category = apiCat.groupName;
        categoriesMoved++;
      }
    }

    if (Object.keys(updates).length > 0) {
      await ctx.db
        .update(schema.budgetItems)
        .set(updates)
        .where(eq(schema.budgetItems.id, item.id));
    }
    if (newApiCategoryName !== null && item.apiCategoryId) {
      await setBudgetItemLink(ctx.db, {
        budgetItemId: item.id,
        service,
        categoryId: item.apiCategoryId,
        categoryName: newApiCategoryName,
      });
    }
  }

  // Savings goals with a primary link for this service
  const allGoalRows = await ctx.db
    .select({ id: schema.savingsGoals.id, name: schema.savingsGoals.name })
    .from(schema.savingsGoals);
  const goalLinks = await loadSavingsGoalLinks(
    ctx.db,
    allGoalRows.map((g) => g.id),
    service,
    "primary",
  );
  const goals = allGoalRows
    .map((g) => {
      const link = goalLinks.get(g.id);
      return {
        ...g,
        apiCategoryId: link?.categoryId ?? null,
        apiCategoryName: link?.categoryName ?? null,
      };
    })
    .filter((g) => g.apiCategoryId);

  for (const goal of goals) {
    const currentGoalApiName =
      (goal.apiCategoryId
        ? apiCategoryMap.get(goal.apiCategoryId)?.name
        : null) ?? goal.apiCategoryName;
    if (!currentGoalApiName || goal.name === currentGoalApiName) continue;
    if (input.direction === "pull") {
      await ctx.db
        .update(schema.savingsGoals)
        .set({ name: currentGoalApiName })
        .where(eq(schema.savingsGoals.id, goal.id));
      await setSavingsGoalLink(ctx.db, {
        savingsGoalId: goal.id,
        service,
        role: "primary",
        categoryId: goal.apiCategoryId!,
        categoryName: currentGoalApiName,
      });
    } else {
      await setSavingsGoalLink(ctx.db, {
        savingsGoalId: goal.id,
        service,
        role: "primary",
        categoryId: goal.apiCategoryId!,
        categoryName: goal.name,
      });
    }
    savingsRenamed++;
  }

  return { ok: true, budgetRenamed, savingsRenamed, categoriesMoved };
}
