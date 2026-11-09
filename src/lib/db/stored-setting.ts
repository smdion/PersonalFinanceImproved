/**
 * A stored value as read (an app_settings value, a jsonb or varchar column):
 * checked once against the shape its writer stores; a value the check
 * refuses is logged and read as stored (any install loads).
 */
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import type { DbOrTx } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import {
  passOnAsStored,
  readStoredShape,
  type StoredShapeRead,
} from "@/lib/db/stored-shape";

/** The stored value itself (`readStoredShape`). `source` names it in the
 *  log (`app_settings.<key>`, `<table>.<column>`); a refused value is logged
 *  once per process per source and passed on as stored. */
export function readStoredValue<S extends z.ZodType>(
  source: string,
  value: unknown,
  shape: S,
): z.output<S> {
  return passOnAsStored(checkStoredValue(source, value, shape));
}

function checkStoredValue<S extends z.ZodType>(
  source: string,
  value: unknown,
  shape: S,
): StoredShapeRead<z.output<S>> {
  return readStoredShape(value, shape, {
    event: "stored_value_unexpected_shape",
    key: () => source,
    data: (issues) => ({ source, issues: issues.slice(0, 5) }),
  });
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

/** A stamp setting's stored value, checked: for a reader that sets a
 *  refused stamp aside instead of passing it on. */
export function checkStoredStamp(
  key: string,
  value: unknown,
): StoredShapeRead<string | undefined> {
  return checkStoredValue(`app_settings.${key}`, value, stampShape);
}
