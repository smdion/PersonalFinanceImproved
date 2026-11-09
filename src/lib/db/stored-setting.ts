/**
 * A stored value as read (an app_settings value, a jsonb or varchar column):
 * checked once against the shape its writer stores; a value the check
 * refuses is logged and read as stored (any install loads).
 */
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import type { DbOrTx } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { logWarnOnce } from "@/lib/logger";

/** The stored value itself, never a parsed copy. `source` names it in the
 *  log (`app_settings.<key>`, `<table>.<column>`); a refused value is
 *  logged once per process per source and passed on as stored. */
export function readStoredValue<S extends z.ZodType>(
  source: string,
  value: unknown,
  shape: S,
): z.output<S> {
  const issues = shape.safeParse(value).error?.issues;
  if (issues)
    logWarnOnce("stored_value_unexpected_shape", source, {
      source,
      issues: issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the value its writer's shape was checked against just above; a refused one passes on as stored (any install loads)
  return value as z.output<S>;
}

/** An app_settings value, read as `readStoredValue` reads one. */
export function readStoredSetting<S extends z.ZodType>(
  key: string,
  value: unknown,
  shape: S,
): z.output<S> {
  return readStoredValue(`app_settings.${key}`, value, shape);
}

/** The setting under `key`, read and checked; undefined when unset. */
export async function loadStoredSetting<S extends z.ZodType>(
  db: DbOrTx,
  key: string,
  shape: S,
): Promise<z.output<S> | undefined> {
  const [row] = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, key));
  return row && readStoredSetting(key, row.value, shape);
}

const stampShape = z.string().optional();

/** A date-time stamp setting (`performance_last_updated`, …); undefined
 *  when unset. */
export function loadStoredStamp(
  db: DbOrTx,
  key: string,
): Promise<string | undefined> {
  return loadStoredSetting(db, key, stampShape);
}

/** A date-time stamp setting (`performance_last_updated`, …) from rows
 *  already loaded; undefined when unset. */
export function findStoredStamp(
  rows: readonly { key: string; value: unknown }[],
  key: string,
): string | undefined {
  return readStoredSetting(
    key,
    rows.find((r) => r.key === key)?.value,
    stampShape,
  );
}
