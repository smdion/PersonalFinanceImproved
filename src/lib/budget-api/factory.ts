// Factory: reads active_budget_api + api_connections, returns the correct client or null.

import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { readMaybeEncrypted } from "@/lib/crypto";
import type { BudgetAPIClient } from "./interface";
import type { ActiveBudgetApi, YnabConfig, ActualConfig } from "./types";
import { YnabClient } from "./ynab-client";
import { ActualClient } from "./actual-client";

type Db = typeof import("@/lib/db").db;

/** Get the active budget API setting. Returns 'none' if not configured. */
export async function getActiveBudgetApi(db: Db): Promise<ActiveBudgetApi> {
  const rows = await db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "active_budget_api"))
    .limit(1);

  const row = rows[0];
  if (!row) return "none";
  const val = row.value;
  if (val === "ynab" || val === "actual") return val;
  return "none";
}

/**
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
  service: "ynab" | "actual",
): Promise<BudgetAPIClient | null> {
  const connections = await db
    .select()
    .from(schema.apiConnections)
    .where(eq(schema.apiConnections.service, service))
    .limit(1);

  const conn = connections[0];
  if (!conn) return null;

  // conn.config may be plaintext (legacy v4) or an encrypted envelope (v5+).
  // readMaybeEncrypted detects the format and decrypts only if necessary,
  // so existing v4 deployments keep working until the next saveConnection
  // upgrades the row to encrypted-at-rest.
  if (service === "ynab") {
    const ynabConfig = readMaybeEncrypted<YnabConfig>(conn.config);
    if (!ynabConfig.accessToken || !ynabConfig.budgetId) return null;
    return new YnabClient(ynabConfig.accessToken, ynabConfig.budgetId);
  }

  if (service === "actual") {
    const actualConfig = readMaybeEncrypted<ActualConfig>(conn.config);
    if (
      !actualConfig.serverUrl ||
      !actualConfig.apiKey ||
      !actualConfig.budgetSyncId
    )
      return null;
    return new ActualClient(
      actualConfig.serverUrl,
      actualConfig.apiKey,
      actualConfig.budgetSyncId,
    );
  }

  return null;
}

/** Get the api_connections row for a service, or null if not configured. */
export async function getApiConnection(db: Db, service: "ynab" | "actual") {
  const rows = await db
    .select()
    .from(schema.apiConnections)
    .where(eq(schema.apiConnections.service, service))
    .limit(1);
  return rows[0] ?? null;
}
