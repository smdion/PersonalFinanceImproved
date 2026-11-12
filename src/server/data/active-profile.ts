/** Which Contribution or Salary Profile is active: the one reader of its stored id. */
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db";
import {
  SK_ACTIVE_CONTRIB_PROFILE_ID,
  SK_ACTIVE_RETIREMENT_PROFILE_ID,
  SK_ACTIVE_SALARY_PROFILE_ID,
} from "@/lib/constants/settings-keys";
import { storedInteger } from "@/lib/utils/stored-integer";

/** The app setting that holds each kind's active profile id. */
export const ACTIVE_SETTING_KEY = {
  contribution: SK_ACTIVE_CONTRIB_PROFILE_ID,
  salary: SK_ACTIVE_SALARY_PROFILE_ID,
  retirement: SK_ACTIVE_RETIREMENT_PROFILE_ID,
} as const;

/** The active Contribution or Salary Profile's id among app settings rows: null when none is
 *  set; a stored value that isn't a whole id is refused (BAD_REQUEST), never read as none. */
export function activeProfileIdFrom(
  rows: readonly { key: string; value: unknown }[],
  kind: "contribution" | "salary",
): number | null {
  const raw = rows.find((r) => r.key === ACTIVE_SETTING_KEY[kind])?.value;
  if (raw == null) return null;
  const id = storedInteger(raw, null);
  if (id === null)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `The stored active ${kind} profile isn't a profile id: pick the active profile again.`,
    });
  return id;
}

/** The active Contribution or Salary Profile's id, read from its setting (activeProfileIdFrom). */
export async function activeProfileId(
  db: Pick<Db, "select">,
  kind: "contribution" | "salary",
): Promise<number | null> {
  const rows = await db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, ACTIVE_SETTING_KEY[kind]));
  return activeProfileIdFrom(rows, kind);
}
