import type { Db } from "@/lib/db";
import type { RequestScope } from "@/server/data/request-scope";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as schema from "@/lib/db/schema";
import { getResolvedGoalAllocations } from "@/server/services/savings/savings-allocation";
import { loadSavingsGoalLinks } from "@/server/data/category-links";
import { getActiveBudgetProfile } from "@/server/data/budget-profiles";
import { log } from "@/lib/logger";
import {
  cacheGet,
  refreshCategoryCache,
  BudgetApiError,
  isTransientError,
} from "@/lib/budget-api";
import { requireBudgetClient } from "@/server/services/budget/budget-client";
import {
  WriteStopped,
  nothingChanged,
  userMessageFor,
} from "@/lib/budget-api/errors";
import type { PreparedGoalWrite, BudgetCategoryGroup } from "@/lib/budget-api";
import {
  getEssentialExpenses,
  resolveEfundTierIndex,
} from "@/lib/pure/savings/efund-expenses";
import { DEFAULT_EFUND_MONTHS } from "@/lib/pure/savings/efund";

export async function pushContributionsToApi(
  ctx: { db: Db; scope: RequestScope },
  input: { goalId?: number } | undefined,
) {
  // The service is resolved once: the end of this call refreshes its cache.
  const { service: active, client } = await requireBudgetClient(
    ctx.db,
    "No budget API active",
  );

  const [goals, activeProfile, budgetItems, appSettings] = await Promise.all([
    // A deactivated fund's old target is not what the plan funds.
    ctx.db
      .select()
      .from(schema.savingsGoals)
      .where(eq(schema.savingsGoals.isActive, true)),
    getActiveBudgetProfile(ctx.db),
    ctx.db.select().from(schema.budgetItems),
    ctx.db.select().from(schema.appSettings),
  ]);

  const pushGoalLinks = await loadSavingsGoalLinks(
    ctx.db,
    goals.map((g) => g.id),
    active,
    "primary",
  );
  const linked = goals
    .map((g) => ({
      ...g,
      apiCategoryId: pushGoalLinks.get(g.id)?.categoryId ?? null,
    }))
    .filter((g) => g.apiCategoryId);
  const toPush = input?.goalId
    ? linked.filter((g) => g.id === input.goalId)
    : linked;

  if (toPush.length === 0)
    return {
      pushed: 0,
      skippedUnsupported: 0,
      failed: 0,
      failureMessage: undefined,
      service: active,
    };

  // Same tier resolution as computeSummary — see resolveEfundTierIndex.
  const efundTierIndex = resolveEfundTierIndex(
    appSettings,
    undefined,
    activeProfile?.columnLabels.length,
  );
  const essentialExpenses = activeProfile
    ? getEssentialExpenses(
        budgetItems as {
          profileId: number;
          isEssential: boolean;
          amounts: number[];
        }[],
        activeProfile.id,
        efundTierIndex,
        activeProfile.columnMonths ?? null,
      )
    : 0;

  // Each goal's funding for the active profile, resolved as computeSummary
  // resolves it (savings_goals holds no funding of its own).
  const resolvedByGoal = await getResolvedGoalAllocations(
    ctx.db,
    toPush,
    activeProfile?.id ?? null,
  );

  // A fund taken to $0 clears the target it had; one that never had a
  // target isn't written to.
  const categoriesCache = await cacheGet<BudgetCategoryGroup[]>(
    ctx.db,
    active,
    "categories",
  );
  const currentTarget = new Map(
    (categoriesCache?.data ?? [])
      .flatMap((g) => g.categories)
      .map((c) => [c.id, c.goalTarget ?? 0]),
  );

  // Goals the provider can't write ("unsupported") or whose target has
  // another shape ("conflict", see BudgetAPIClient.prepareGoalWrite):
  // reported apart, so the UI never says "already up to date" for them.
  let skippedUnsupported = 0;
  // Every read before the first write: a read that fails stops the push
  // with nothing written.
  const prepared: { goalId: number; write: PreparedGoalWrite }[] = [];
  for (const goal of toPush) {
    try {
      if (goal.isEmergencyFund) {
        // E-fund: the total target amount only. Its goal type is set up
        // once in YNAB; a "target-balance" write never changes it (see
        // YnabClient's writeTargetBalance).
        const targetMonths = goal.targetMonths ?? DEFAULT_EFUND_MONTHS;
        const targetAmount = targetMonths * essentialExpenses;
        if (targetAmount > 0) {
          prepared.push({
            goalId: goal.id,
            write: await client.prepareGoalWrite(
              goal.apiCategoryId!,
              "target-balance",
              targetAmount,
            ),
          });
        }
      } else {
        // Push the resolved snapshot: a percentage goal's dollars move only when the
        // user hits "Recalculate" (recalculateAllocation), not with paycheck changes.
        const monthly = resolvedByGoal.get(goal.id)?.monthlyContribution ?? 0;
        if (monthly > 0 || (currentTarget.get(goal.apiCategoryId!) ?? 0) > 0) {
          prepared.push({
            goalId: goal.id,
            write: await client.prepareGoalWrite(
              goal.apiCategoryId!,
              "monthly",
              monthly,
            ),
          });
        }
      }
    } catch (err) {
      if (
        err instanceof BudgetApiError &&
        (err.code === "unsupported" || err.code === "conflict")
      ) {
        skippedUnsupported++;
      } else {
        throw nothingChanged(err);
      }
    }
  }

  let pushed = 0;
  // A transient write failure is counted per goal (never read as "up to
  // date"); any other failure stops the push, since the next goal fails
  // the same way.
  let failed = 0;
  let firstFailureMessage: string | undefined;
  let stopError: unknown;
  for (const { goalId, write } of prepared) {
    try {
      await write.apply();
      pushed++;
    } catch (err) {
      if (!isTransientError(err)) {
        stopError = err;
        break;
      }
      const message = err instanceof Error ? err.message : String(err);
      log("warn", "push_goal_target_failed", { goalId, error: message });
      failed++;
      firstFailureMessage ??= userMessageFor(err) ?? message;
    }
  }

  // Previews must show what was just pushed (as budget.syncBudgetToApi);
  // a refresh failure must not turn pushes that landed into an error.
  if (pushed > 0) {
    try {
      await refreshCategoryCache(ctx, active, client);
    } catch (err) {
      log("error", "post_push_cache_refresh_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (stopError !== undefined)
    // Some targets may already be written: say how many.
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Pushed ${pushed} of ${prepared.length} savings targets, then failed: ${stopError instanceof Error ? stopError.message : String(stopError)}`,
      cause: new WriteStopped(
        `Pushed ${pushed} of ${prepared.length} savings targets`,
        `Pushed ${pushed} of ${prepared.length} savings targets before it stopped.`,
        stopError,
      ),
    });

  return {
    pushed,
    skippedUnsupported,
    failed,
    failureMessage: firstFailureMessage,
    service: active,
  };
}
