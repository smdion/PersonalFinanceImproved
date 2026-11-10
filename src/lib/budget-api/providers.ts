// The budget providers: one entry per BudgetApiService, each with its
// client, built from a stored connection (labels: BUDGET_SERVICES).

import "server-only";
import type { BudgetApiService } from "@/lib/config/budget-apps";
import type { BudgetAPIClient } from "./interface";
import { readActualConfig, readYnabConfig } from "./stored-config";
import { YnabClient } from "./ynab-client";
import { ActualClient } from "./actual-client";

interface BudgetProvider {
  /** The client for a stored `api_connections.config` (an encrypted
   *  envelope), or null when a field is missing; a refused config is logged. */
  createClient(storedConfig: unknown): BudgetAPIClient | null;
}

export const BUDGET_PROVIDERS = {
  ynab: {
    createClient(storedConfig) {
      const c = readYnabConfig(storedConfig);
      if (!c.accessToken || !c.budgetId) return null;
      return new YnabClient(c.accessToken, c.budgetId);
    },
  },
  actual: {
    createClient(storedConfig) {
      const c = readActualConfig(storedConfig);
      if (!c.serverUrl || !c.apiKey || !c.budgetSyncId) return null;
      return new ActualClient(c.serverUrl, c.apiKey, c.budgetSyncId);
    },
  },
} as const satisfies Record<BudgetApiService, BudgetProvider>;
