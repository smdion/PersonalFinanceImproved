/**
 * Whether this install still needs its first admin: the one answer for
 * `settings.getFirstRunState`, the /login page and `settings.createLocalAdmin`'s guard.
 */
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { log } from "@/lib/logger";
import { oidcConfigured } from "@/server/auth-mode";
import type { DbOrTx } from "@/lib/db";
import { upsertSetting } from "@/server/data/settings";
import { SK_ONBOARDING_COMPLETED } from "@/lib/constants/settings-keys";
import { onboardingClosesGate } from "@/lib/db/onboarding-gate";

/** The stored `onboarding_completed`: true, false, or null when unset. */
async function onboardingFlag(db: DbOrTx): Promise<boolean | null> {
  const [row] = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, SK_ONBOARDING_COMPLETED));
  return row?.value === true ? true : row?.value === false ? false : null;
}

async function peopleExist(db: DbOrTx): Promise<boolean> {
  const rows = await db
    .select({ id: schema.people.id })
    .from(schema.people)
    .limit(1);
  return rows.length > 0;
}

/** Onboarding is complete once the wizard finished or a person exists. */
export async function checkOnboardingComplete(db: DbOrTx): Promise<boolean> {
  return (await onboardingFlag(db)) === true || peopleExist(db);
}

export async function localAdminExists(db: DbOrTx): Promise<boolean> {
  const rows = await db
    .select({ id: schema.localAdmins.id })
    .from(schema.localAdmins)
    .limit(1);
  return rows.length > 0;
}

/**
 * Needed while no local admin exists and onboarding isn't complete (OIDC-only installs
 * close it by onboarding); `onboarding_completed = false` keeps it open. Never in DEMO_ONLY.
 */
export async function firstRunState(
  db: DbOrTx,
): Promise<{ adminNeeded: boolean }> {
  // The read-only demo has no sign-in and never takes an admin.
  if (process.env.DEMO_ONLY === "true") return { adminNeeded: false };
  if (await localAdminExists(db)) return { adminNeeded: false };
  const flag = await onboardingFlag(db);
  const people = flag === null && (await peopleExist(db));
  return { adminNeeded: !onboardingClosesGate(flag, people) };
}

/**
 * After a reset, restore or import: close the first-admin gate when a way to sign in
 * remains (a local admin, or Authentik), else leave it open so the household isn't locked out.
 */
export async function settleFirstRunGate(
  db: DbOrTx,
  after: "reset" | "restore" | "import",
): Promise<void> {
  const signInRemains = (await localAdminExists(db)) || oidcConfigured();
  await upsertSetting(db, SK_ONBOARDING_COMPLETED, signInRemains);
  if (!signInRemains)
    log("warn", "first_admin_gate_open", {
      after,
      message:
        "No local admin and no Authentik configured: /login offers creating the first admin.",
    });
}
