// Factory: reads active_budget_api + api_connections, returns the correct client or null.

import "server-only";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { isBudgetApiService } from "@/lib/config/budget-apps";
import type { BudgetAPIClient } from "./interface";
import type { ActiveBudgetApi, BudgetApiService } from "./types";
import { BUDGET_PROVIDERS } from "./providers";
import type { Db } from "@/lib/db";

/** Get the active budget API setting. Returns 'none' if not configured. */
export async function getActiveBudgetApi(db: Db): Promise<ActiveBudgetApi> {
  const rows = await db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "active_budget_api"))
    .limit(1);

  const row = rows[0];
  if (!row) return "none";
  // An unknown stored service reads as "none".
  return isBudgetApiService(row.value) ? row.value : "none";
}

/** @internal Only tests import it (knip --production).
 * Instantiate the correct BudgetAPIClient based on app settings (active API).
 * Returns null if no budget API is configured or the connection is missing.
 */
export async function getBudgetAPIClient(
  db: Db,
): Promise<BudgetAPIClient | null> {
  const active = await getActiveBudgetApi(db);
  if (active === "none") return null;
  return getClientForService(db, active);
}

/**
 * Instantiate a BudgetAPIClient for a specific service, regardless of which API is active.
 * Used for preview/sync before activation.
 */
export async function getClientForService(
  db: Db,
  service: BudgetApiService,
): Promise<BudgetAPIClient | null> {
  const connections = await db
    .select()
    .from(schema.apiConnections)
    .where(eq(schema.apiConnections.service, service))
    .limit(1);

  const conn = connections[0];
  if (!conn) return null;

  // conn.config may be plaintext or an encrypted envelope; each provider's
  // createClient reads it with readMaybeEncrypted.
  if (!Object.hasOwn(BUDGET_PROVIDERS, service)) return null;
  return BUDGET_PROVIDERS[service].createClient(conn.config);
}

/** Get the api_connections row for a service, or null if not configured. */
export async function getApiConnection(db: Db, service: BudgetApiService) {
  const rows = await db
    .select()
    .from(schema.apiConnections)
    .where(eq(schema.apiConnections.service, service))
    .limit(1);
  return rows[0] ?? null;
}
