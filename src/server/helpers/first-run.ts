/**
 * Whether this install still needs its first admin. One answer for the
 * public `settings.firstRunState` query, the /login page and
 * `settings.createLocalAdmin`'s guard, so what the page offers and what
 * the server allows can't drift apart.
 */
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "./transforms";

/** Onboarding is complete once a person exists or the wizard finished. */
export async function checkOnboardingComplete(db: DbOrTx): Promise<boolean> {
  const peopleRows = await db
    .select({ id: schema.people.id })
    .from(schema.people)
    .limit(1);
  if (peopleRows.length > 0) return true;

  const setting = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "onboarding_completed"));
  return setting.length > 0 && setting[0]!.value === true;
}

export async function localAdminExists(db: DbOrTx): Promise<boolean> {
  const rows = await db
    .select({ id: schema.localAdmins.id })
    .from(schema.localAdmins)
    .limit(1);
  return rows.length > 0;
}

/**
 * An admin is needed while no local admin exists and onboarding isn't
 * complete. An OIDC-only install never has a local admin, so onboarding
 * completion also closes it. Never under DEMO_ONLY.
 */
export async function firstRunState(
  db: DbOrTx,
): Promise<{ adminNeeded: boolean }> {
  // The read-only demo has no sign-in and never takes an admin.
  if (process.env.DEMO_ONLY === "true") return { adminNeeded: false };
  if (await localAdminExists(db)) return { adminNeeded: false };
  return { adminNeeded: !(await checkOnboardingComplete(db)) };
}
