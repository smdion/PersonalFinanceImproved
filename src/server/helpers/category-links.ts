/**
 * Per-service budget API category link helpers.
 *
 * budget_items and savings_goals used to store exactly ONE budget-API
 * category link each (apiCategoryId/apiCategoryName/... columns), but
 * BudgetApiService is "ynab" | "actual" — a household with BOTH services
 * connected could only hold one service's link at a time, so re-linking to
 * the second service silently clobbered the first. budget_item_category_
 * links and savings_goal_category_links (schema-pg.ts) hold one row per
 * (item/goal, service[, role]) instead. These helpers are the only place
 * that should read or write those two tables — see docs/RULES.md and
 * CHANGELOG.md [0.7.11].
 *
 * The old raw columns stay on budget_items/savings_goals, dead-but-present,
 * through v0.7.x (cleanup deferred to a future v0.8.0 squash).
 */
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Db } from "./transforms";
import type {
  BudgetApiService,
  ApiSyncDirection,
} from "@/lib/config/enum-values";

export type SavingsGoalLinkRole = "primary" | "reimbursement";

export type BudgetItemLink = {
  categoryId: string;
  categoryName: string | null;
  lastSyncedAt: Date | null;
  syncDirection: ApiSyncDirection | null;
};

export type SavingsGoalLink = {
  categoryId: string;
  categoryName: string | null;
  lastSyncedAt: Date | null;
};

/** Batch-load every budget item's link for a single service. Single query — use for N items, never N+1. */
export async function loadBudgetItemLinks(
  db: Db,
  itemIds: number[],
  service: BudgetApiService,
): Promise<Map<number, BudgetItemLink>> {
  const result = new Map<number, BudgetItemLink>();
  if (itemIds.length === 0) return result;

  const rows = await db
    .select()
    .from(schema.budgetItemCategoryLinks)
    .where(
      and(
        inArray(schema.budgetItemCategoryLinks.budgetItemId, itemIds),
        eq(schema.budgetItemCategoryLinks.service, service),
      ),
    );

  for (const row of rows) {
    result.set(row.budgetItemId, {
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      lastSyncedAt: row.lastSyncedAt,
      syncDirection: row.syncDirection,
    });
  }
  return result;
}

export async function setBudgetItemLink(
  db: Db,
  params: {
    budgetItemId: number;
    service: BudgetApiService;
    categoryId: string;
    categoryName?: string | null;
    syncDirection?: ApiSyncDirection | null;
    lastSyncedAt?: Date | null;
  },
): Promise<void> {
  const {
    budgetItemId,
    service,
    categoryId,
    categoryName = null,
    syncDirection = null,
    lastSyncedAt = null,
  } = params;

  await db
    .insert(schema.budgetItemCategoryLinks)
    .values({
      budgetItemId,
      service,
      categoryId,
      categoryName,
      syncDirection,
      lastSyncedAt,
    })
    .onConflictDoUpdate({
      target: [
        schema.budgetItemCategoryLinks.budgetItemId,
        schema.budgetItemCategoryLinks.service,
      ],
      set: { categoryId, categoryName, syncDirection, lastSyncedAt },
    });
}

export async function deleteBudgetItemLink(
  db: Db,
  params: { budgetItemId: number; service: BudgetApiService },
): Promise<void> {
  await db
    .delete(schema.budgetItemCategoryLinks)
    .where(
      and(
        eq(schema.budgetItemCategoryLinks.budgetItemId, params.budgetItemId),
        eq(schema.budgetItemCategoryLinks.service, params.service),
      ),
    );
}

/** Batch-load every savings goal's link for a single (service, role). Single query — use for N goals, never N+1. */
export async function loadSavingsGoalLinks(
  db: Db,
  goalIds: number[],
  service: BudgetApiService,
  role: SavingsGoalLinkRole = "primary",
): Promise<Map<number, SavingsGoalLink>> {
  const result = new Map<number, SavingsGoalLink>();
  if (goalIds.length === 0) return result;

  const rows = await db
    .select()
    .from(schema.savingsGoalCategoryLinks)
    .where(
      and(
        inArray(schema.savingsGoalCategoryLinks.savingsGoalId, goalIds),
        eq(schema.savingsGoalCategoryLinks.service, service),
        eq(schema.savingsGoalCategoryLinks.role, role),
      ),
    );

  for (const row of rows) {
    result.set(row.savingsGoalId, {
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      lastSyncedAt: row.lastSyncedAt,
    });
  }
  return result;
}

export async function setSavingsGoalLink(
  db: Db,
  params: {
    savingsGoalId: number;
    service: BudgetApiService;
    role?: SavingsGoalLinkRole;
    categoryId: string;
    categoryName?: string | null;
    lastSyncedAt?: Date | null;
  },
): Promise<void> {
  const {
    savingsGoalId,
    service,
    role = "primary",
    categoryId,
    categoryName = null,
    lastSyncedAt = null,
  } = params;

  await db
    .insert(schema.savingsGoalCategoryLinks)
    .values({
      savingsGoalId,
      service,
      role,
      categoryId,
      categoryName,
      lastSyncedAt,
    })
    .onConflictDoUpdate({
      target: [
        schema.savingsGoalCategoryLinks.savingsGoalId,
        schema.savingsGoalCategoryLinks.service,
        schema.savingsGoalCategoryLinks.role,
      ],
      set: { categoryId, categoryName, lastSyncedAt },
    });
}

export async function deleteSavingsGoalLink(
  db: Db,
  params: {
    savingsGoalId: number;
    service: BudgetApiService;
    role?: SavingsGoalLinkRole;
  },
): Promise<void> {
  const role = params.role ?? "primary";
  await db
    .delete(schema.savingsGoalCategoryLinks)
    .where(
      and(
        eq(schema.savingsGoalCategoryLinks.savingsGoalId, params.savingsGoalId),
        eq(schema.savingsGoalCategoryLinks.service, params.service),
        eq(schema.savingsGoalCategoryLinks.role, role),
      ),
    );
}

/**
 * Used by convertBudgetItemToGoal: copies a budget item's PRIMARY link for
 * the given service (if any) onto the newly-created savings goal as its
 * primary link. No-op if the item has no link for that service.
 */
export async function copySavingsGoalLinks(
  db: Db,
  params: {
    fromBudgetItemId: number;
    toSavingsGoalId: number;
    service: BudgetApiService;
  },
): Promise<void> {
  const links = await loadBudgetItemLinks(
    db,
    [params.fromBudgetItemId],
    params.service,
  );
  const link = links.get(params.fromBudgetItemId);
  if (!link) return;

  await setSavingsGoalLink(db, {
    savingsGoalId: params.toSavingsGoalId,
    service: params.service,
    role: "primary",
    categoryId: link.categoryId,
    categoryName: link.categoryName,
    lastSyncedAt: link.lastSyncedAt,
  });
}
