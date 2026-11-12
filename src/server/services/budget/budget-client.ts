import { TRPCError } from "@trpc/server";
import {
  getActiveBudgetApi,
  getClientForService,
  type BudgetAPIClient,
  type BudgetApiService,
} from "@/lib/budget-api";
import type { Db, DbOrTx } from "@/lib/db";
import { resolveTargetBudgetProfile } from "@/server/data/budget-profiles";
import { lockedTargetBudgetProfile } from "@/server/data/budget-profile-lock";

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
 *  active or its connection is missing. */
export async function requireBudgetClient(
  db: Db,
): Promise<{ service: BudgetApiService; client: BudgetAPIClient }> {
  const service = await requireActiveBudgetApi(db);
  const client = await getClientForService(db, service);
  if (!client) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Budget API client not available",
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

/** The target profile (`profileId`, else the active one) read under its
 *  row lock in `tx`; BAD_REQUEST when there is none. */
export async function requireLockedBudgetProfile(
  tx: DbOrTx,
  profileId: number | undefined,
) {
  const profile = await lockedTargetBudgetProfile(tx, profileId);
  if (!profile)
    throw new TRPCError({ code: "BAD_REQUEST", message: "No active profile" });
  return profile;
}
