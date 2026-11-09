/** The Performance page's last-updated stamp, written after every performance edit. */
import type { DbOrTx } from "@/lib/db";
import { upsertSetting } from "@/server/data/settings";
import { writeStamp } from "@/lib/utils/clock";

/** Stamp performance_last_updated in app_settings */
export async function stampPerformanceUpdated(db: DbOrTx) {
  const now = writeStamp().toISOString();
  await upsertSetting(db, "performance_last_updated", now);
}
