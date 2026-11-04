// The budget providers: one entry per BudgetApiService, each with its
// client, built from a stored connection (labels: BUDGET_SERVICES).

import "server-only";
import { readMaybeEncrypted } from "@/lib/crypto";
import type { BudgetApiService } from "@/lib/config/budget-apps";
import type { BudgetAPIClient } from "./interface";
import type { YnabConfig, ActualConfig } from "./types";
import { YnabClient } from "./ynab-client";
import { ActualClient } from "./actual-client";

interface BudgetProvider {
  /** The client for a stored `api_connections.config` (plaintext or
   *  encrypted), or null when a field is missing. Cast, not validated. */
  createClient(storedConfig: unknown): BudgetAPIClient | null;
}

export const BUDGET_PROVIDERS = {
  ynab: {
    createClient(storedConfig) {
      const c = readMaybeEncrypted<YnabConfig>(storedConfig);
      if (!c.accessToken || !c.budgetId) return null;
      return new YnabClient(c.accessToken, c.budgetId);
    },
  },
  actual: {
    createClient(storedConfig) {
      const c = readMaybeEncrypted<ActualConfig>(storedConfig);
      if (!c.serverUrl || !c.apiKey || !c.budgetSyncId) return null;
      return new ActualClient(c.serverUrl, c.apiKey, c.budgetSyncId);
    },
  },
} as const satisfies Record<BudgetApiService, BudgetProvider>;
