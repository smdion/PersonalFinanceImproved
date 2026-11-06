import { TRPCError } from "@trpc/server";
import {
  getActiveBudgetApi,
  getClientForService,
  type BudgetAPIClient,
  type BudgetApiService,
} from "@/lib/budget-api";
import type { Db } from "@/lib/db";
import { resolveTargetBudgetProfile } from "@/server/data/budget-profiles";

/** The active budget API's service; PRECONDITION_FAILED when none is. */
export async function requireActiveBudgetApi(
  db: Db,
): Promise<BudgetApiService> {
  const active = await getActiveBudgetApi(db);
  if (active === "none") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No budget API active",
    });
  }
  return active;
}

/** The active budget API and its client; PRECONDITION_FAILED when none is
 *  active or its connection is missing (`noClientMessage`). */
export async function requireBudgetClient(
  db: Db,
  noClientMessage = "Budget API client not available",
): Promise<{ service: BudgetApiService; client: BudgetAPIClient }> {
  const service = await requireActiveBudgetApi(db);
  const client = await getClientForService(db, service);
  if (!client) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: noClientMessage,
    });
  }
  return { service, client };
}

/** The budget profile an edit targets (`profileId`, else the active one);
 *  BAD_REQUEST when there is none. */
export async function requireBudgetProfile(
  db: Db,
  profileId: number | undefined,
) {
  const profile = await resolveTargetBudgetProfile(db, profileId);
  if (!profile)
    throw new TRPCError({ code: "BAD_REQUEST", message: "No active profile" });
  return profile;
}
