/**
 * `pnpm seed [<household>]`: one invented demo household (lib/demo) into the
 * empty dev database `.env` names, after `pnpm db:migrate`. Never real data.
 */
import { inArray } from "drizzle-orm";
import { DEMO_PROFILES, getDemoProfile } from "@/lib/demo";
import {
  SK_ACTIVE_CONTRIB_PROFILE_ID,
  SK_ACTIVE_SALARY_PROFILE_ID,
} from "@/lib/constants/settings-keys";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db";
import { loadEnvFile } from "@/lib/db/env-file";
import { log } from "@/lib/logger";
import { writeStamp } from "@/lib/utils/clock";
import { seedProfile } from "@/server/services/demo/demo-seed";

export const DEV_SEED_DEFAULT_HOUSEHOLD = "dual-income-family";

/** Load the demo household `slug` names into an empty database (one that
 *  holds no people), so nothing real is ever mixed in. */
export async function seedDevDatabase(
  db: Db,
  slug: string,
  seededOn: Date,
): Promise<void> {
  const profile = getDemoProfile(slug);
  if (!profile)
    throw new Error(
      `No demo household "${slug}". Choose one of: ${Object.keys(DEMO_PROFILES).join(", ")}.`,
    );
  const [anyone] = await db
    .select({ id: schema.people.id })
    .from(schema.people)
    .limit(1);
  if (anyone)
    throw new Error(
      "The database already holds a household. The dev seed loads into an empty database only: point .env at a new one and run pnpm db:migrate first.",
    );
  // A migrated install starts with a default Salary and Contribution
  // profile, set active; the household brings its own, as a demo schema does.
  await db
    .delete(schema.appSettings)
    .where(
      inArray(schema.appSettings.key, [
        SK_ACTIVE_CONTRIB_PROFILE_ID,
        SK_ACTIVE_SALARY_PROFILE_ID,
      ]),
    );
  await db.delete(schema.contributionProfiles);
  await db.delete(schema.salaryProfiles);
  await seedProfile(db, profile, seededOn);
}

async function main(): Promise<void> {
  loadEnvFile();
  const { db } = await import("@/lib/db");
  const slug = process.argv[2] ?? DEV_SEED_DEFAULT_HOUSEHOLD;
  // A run outside any request reads the clock once, at its start.
  await seedDevDatabase(db, slug, writeStamp());
  log("info", "dev_seed_loaded", { household: slug });
}

// Importable by tests without seeding anything.
if (!process.env.VITEST) {
  main().then(
    () => process.exit(0),
    (err: unknown) => {
      log("error", "dev_seed_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    },
  );
}
