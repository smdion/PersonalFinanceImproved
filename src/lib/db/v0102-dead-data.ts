/** Restore step, and migration 0015 for live rows (keep the two together):
 *  a holding observation loses `performance_account_id` (only SimpleFIN
 *  rows are kept), and the settings no version of Ledgr reads go. */

import { log } from "@/lib/logger";
import { v0810Object as asObject } from "./v0810-profile-sets";

/** The `app_settings` keys migration 0015 deletes. */
export const DEAD_SETTING_KEYS: ReadonlySet<string> = new Set([
  "dave_ramsey_benchmarks",
  "default_budget_tier_index",
  "include_home_growth_in_networth",
  "lt_brokerage_annual_contribution_increase",
  "match_income_threshold",
  "match_income_threshold_inflation",
  "money_guy_wealth_targets",
  "retirement_target_contribution_rate",
  "use_3yr_salary_average",
  "wealth_score_start_year",
]);

export function dropDeadHoldingLinkAndSettings(
  tables: Record<string, unknown[]>,
): void {
  const holdings = tables["holding_observations"];
  if (holdings) {
    const kept: unknown[] = [];
    for (const raw of holdings) {
      const row = asObject(raw);
      if (!row) {
        kept.push(raw);
        continue;
      }
      // A row with no SimpleFIN account can't be stored now (NOT NULL);
      // no version of Ledgr wrote one.
      if (row["simplefin_account_id"] == null) {
        log("warn", "backup_holding_without_simplefin_account_dropped", {
          id: row["id"],
        });
        continue;
      }
      delete row["performance_account_id"];
      kept.push(row);
    }
    tables["holding_observations"] = kept;
  }
  const settings = tables["app_settings"];
  if (settings)
    tables["app_settings"] = settings.filter((raw) => {
      const key = asObject(raw)?.["key"];
      return typeof key !== "string" || !DEAD_SETTING_KEYS.has(key);
    });
}
