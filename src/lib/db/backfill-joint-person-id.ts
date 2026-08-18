/**
 * Auto-backfill contribution_accounts.person_id → NULL for joint-ownership
 * rows (F4). Runs on startup (via instrumentation.ts). Idempotent — only
 * touches rows where ownership is "joint" and personId is still set.
 *
 * Rows with no jobId that ANY Contribution Profile sets to "percent_of_salary"
 * are skipped and logged instead of nulled: the salary-resolution fallback in
 * server/helpers/contribution.ts falls back to job-by-personId, which would
 * silently resolve to salary 0 once personId is cleared. contributionMethod
 * is profile-owned (no account-level value), so every profile's active
 * fields for the row have to be checked, not a single column — different
 * profiles could set different methods for the same account. Those rows
 * need a jobId assigned by the user before the null-out is safe.
 */

import { and, eq, isNotNull } from "drizzle-orm";
import * as schema from "./schema";
import { log } from "@/lib/logger";
import type { db as appDb } from "./index";

type Db = typeof appDb;

export async function backfillJointPersonId(db: Db) {
  const jointRows = await db
    .select()
    .from(schema.contributionAccounts)
    .where(
      and(
        eq(schema.contributionAccounts.ownership, "joint"),
        isNotNull(schema.contributionAccounts.personId),
      ),
    );
  if (jointRows.length === 0) return;

  const profiles = await db.select().from(schema.contributionProfiles);
  const anyProfileSetsPercentOfSalary = (accountId: number): boolean =>
    profiles.some((p) => {
      const root = p.contributionActiveFields as {
        contributionAccounts?: Record<string, { contributionMethod?: string }>;
      };
      return (
        root.contributionAccounts?.[String(accountId)]?.contributionMethod ===
        "percent_of_salary"
      );
    });

  const blocked = jointRows.filter(
    (r) => !r.jobId && anyProfileSetsPercentOfSalary(r.id),
  );
  const clearable = jointRows.filter((r) => !blocked.includes(r));

  for (const row of clearable) {
    await db
      .update(schema.contributionAccounts)
      .set({ personId: null })
      .where(eq(schema.contributionAccounts.id, row.id));
  }

  if (clearable.length > 0) {
    log("info", "backfill_joint_person_id_cleared", {
      count: clearable.length,
    });
  }
  if (blocked.length > 0) {
    log("warn", "backfill_joint_person_id_blocked", {
      count: blocked.length,
      ids: blocked.map((r) => r.id),
      reason:
        "joint + percent_of_salary with no jobId — assign a jobId before person_id can be cleared safely",
    });
  }
}
