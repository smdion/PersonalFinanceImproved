import * as schema from "@/lib/db/schema";
import type { Db, DbOrTx } from "@/lib/db";

/** Insert one app setting, or replace the whole stored value on a key
 *  conflict (SQLite and PostgreSQL alike). To change part of a stored map
 *  without losing a concurrent writer's part, use `mergeSettingAtomically`. */
export async function upsertSetting(
  db: Pick<Db, "insert"> | DbOrTx,
  key: string,
  value: unknown,
): Promise<void> {
  await db
    .insert(schema.appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
}
