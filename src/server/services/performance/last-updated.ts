/** The Performance page's last-updated stamp, written after every performance edit. */
import type { DbOrTx } from "@/lib/db";
import { upsertSetting } from "@/server/data/settings";

/** Stamp performance_last_updated in app_settings */
export async function stampPerformanceUpdated(db: DbOrTx) {
  const now = new Date().toISOString();
  await upsertSetting(db, "performance_last_updated", now);
}
