import { and, isNull, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { EntityFieldMap } from "@/lib/db/schema";
import { roundToCents } from "@/lib/utils/math";
import type { ContribSaveChecker } from "@/server/services/contributions/caps";
import { mergeSalaryProfileJobFields } from "@/lib/pure/household/compensation";
import { loadEffectiveSalaryProfile } from "@/server/services/profiles/salary-profile";
import type { DbOrTx, Db } from "@/lib/db";
import { resolveJoblessPeriodsPerYear } from "@/lib/pure/contributions/contribution-rows";

/**
 * Inverse of computeAnnualContribution for the flat-dollar methods a
 * budget-linked contribution account can use (linking is restricted to
 * jobId === null, so percent_of_salary — which needs a salary — never
 * applies here; reject it loudly rather than silently writing $0).
 */
function computeContributionValueFromMonthly(
  method: string,
  monthlyAmount: number,
  periodsPerYear: number,
): number {
  switch (method) {
    case "fixed_monthly":
      return monthlyAmount;
    case "fixed_per_period":
      return (monthlyAmount * 12) / periodsPerYear;
    case "fixed_annual":
      return monthlyAmount * 12;
    default:
      throw new Error(
        `Cannot edit a "${method}" contribution account from a flat monthly amount`,
      );
  }
}

/**
 * Resolves the shared periods-per-year input `mergeContributionAccountEdit`
 * needs, independent of which profile/account is being edited — split out
 * so a batch of edits (see `applyContributionAccountEditsBatch`) resolves
 * it once instead of once per profile.
 */
async function resolveActiveJobPeriodsPerYear(
  db: DbOrTx,
): Promise<{ periodsPerYear: number; incomplete: boolean }> {
  const rawActiveJobs = await db
    .select()
    .from(schema.jobs)
    .where(
      and(isNull(schema.jobs.endDate), eq(schema.jobs.isSpeculative, false)),
    );
  // Salary Profile is an independent axis from Contribution Profile — a
  // job's pay schedule is never Contribution-Profile-owned, so this always
  // resolves against whichever Salary Profile is globally active, same as
  // loadLiveContribData's own "no specific preference" resolution.
  const salaryProfileActiveMap = await loadEffectiveSalaryProfile(db, null);
  const activeJobs = mergeSalaryProfileJobFields(
    rawActiveJobs,
    salaryProfileActiveMap,
  );
  return resolveJoblessPeriodsPerYear(activeJobs);
}

/**
 * Pure merge step of a contribution-account edit: given a profile's CURRENT
 * `contributionActiveFields` blob and one edit, returns the next blob, or
 * `null` if nothing should change (rounds to the same value already
 * stored, or the account's method needs a pay schedule no active job can
 * supply). No DB access — split out so a batch of edits against the SAME
 * profile can fold through one in-memory snapshot instead of one
 * SELECT+UPDATE round trip per edit (see `applyContributionAccountEditsBatch`).
 */
function mergeContributionAccountEdit(
  activeFields: EntityFieldMap,
  contributionAccountId: number,
  monthlyAmount: number,
  periodsPerYear: number,
  incomplete: boolean,
): EntityFieldMap | null {
  const accountFields = (activeFields.contributionAccounts?.[
    String(contributionAccountId)
  ] ?? {}) as Record<string, unknown>;

  // No account-level method to fall back to — a not-yet-valued account
  // defaults to fixed_monthly, the exact unit this edit is already in.
  const method =
    (accountFields.contributionMethod as string | undefined) ?? "fixed_monthly";

  // No active job anywhere to resolve a pay schedule from. This is a
  // budget-linked (jobId === null) account whose method needs periodsPerYear
  // — nothing sane to write, and this path isn't a user-facing save action
  // that can reject with an error (see the plan's jobless-account
  // treatment), so leave the value as-is rather than writing a fabricated
  // number.
  if (incomplete && method === "fixed_per_period") return null;

  const newValue = roundToCents(
    computeContributionValueFromMonthly(method, monthlyAmount, periodsPerYear),
  );

  const currentValue = accountFields.contributionValue;
  if (
    currentValue != null &&
    Math.abs(newValue - Number(currentValue)) < 0.005
  ) {
    return null;
  }

  return {
    ...activeFields,
    contributionAccounts: {
      ...activeFields.contributionAccounts,
      [String(contributionAccountId)]: {
        ...accountFields,
        contributionValue: String(newValue),
        contributionMethod: method,
      },
    },
  };
}

/**
 * Write-through for editing a budget-linked contribution account's value
 * from a monthly dollar amount (what the Budget page displays/edits).
 * Converts into the account's native unit and skips the write if the
 * profile's already at that value (avoids float/rounding drift on
 * fixed_annual / fixed_per_period round-trips).
 *
 * Writes into `contributionProfileId`'s active fields — accounts carry no
 * value of their own (see applyContribActiveFields), so the caller must
 * have already resolved which profile this edit belongs to (same
 * local selection → active profile precedence the
 * rest of the page uses; see resolveEffectiveContributionProfileIdForItem in
 * routers/budget/item-amounts.ts).
 *
 * Callers editing more than one account should use
 * `applyContributionAccountEditsBatch` instead of looping this — it folds
 * every edit for the same profile through a single read-merge-write.
 */
export async function applyContributionAccountEdit(
  db: DbOrTx,
  contributionAccountId: number,
  monthlyAmount: number,
  contributionProfileId: number,
  /** The IRS-limit save check (assertWithinIrsLimits) — required, so no
   *  budget edit can save a contribution over its limit. */
  check: ContribSaveChecker,
): Promise<void> {
  const { periodsPerYear, incomplete } =
    await resolveActiveJobPeriodsPerYear(db);

  const [profile] = await db
    .select()
    .from(schema.contributionProfiles)
    .where(eq(schema.contributionProfiles.id, contributionProfileId));
  if (!profile) return; // stale FK — nothing to update

  const activeFields = profile.contributionActiveFields as EntityFieldMap;
  const nextActiveFields = mergeContributionAccountEdit(
    activeFields,
    contributionAccountId,
    monthlyAmount,
    periodsPerYear,
    incomplete,
  );
  if (nextActiveFields === null) return;
  await check(db as Db, {
    profileId: contributionProfileId,
    before: activeFields.contributionAccounts ?? {},
    after: nextActiveFields.contributionAccounts ?? {},
    touched: [contributionAccountId],
  });

  await db
    .update(schema.contributionProfiles)
    .set({ contributionActiveFields: nextActiveFields })
    .where(eq(schema.contributionProfiles.id, contributionProfileId));
}

/**
 * Batch form of `applyContributionAccountEdit` — one SELECT + one UPDATE
 * per DISTINCT profile touched, no matter how many accounts in `edits`
 * belong to it, instead of one round trip per account.
 *
 * Why this exists: a multi-cell paste that lands several edits on
 * accounts in the SAME contribution profile previously ran
 * `applyContributionAccountEdit` once per account — N sequential
 * read-merge-write cycles against that one profile row inside the paste's
 * surrounding transaction. Two concurrent writers to the same profile can
 * always lose an update in a plain read-then-write (this app has no
 * optimistic-concurrency check on the row), but N round trips instead of
 * one needlessly repeats the read side of that window N times over the
 * transaction's lifetime for no benefit — folding them into a single
 * read + write removes the repetition. `db` should be a transaction when
 * the caller is also writing other rows in the same request (matches
 * `applyContributionAccountEdit`'s own contract).
 */
export async function applyContributionAccountEditsBatch(
  db: DbOrTx,
  edits: {
    contributionAccountId: number;
    monthlyAmount: number;
    contributionProfileId: number;
  }[],
  /** The IRS-limit save check (assertWithinIrsLimits) — required. */
  check: ContribSaveChecker,
): Promise<void> {
  if (edits.length === 0) return;

  const { periodsPerYear, incomplete } =
    await resolveActiveJobPeriodsPerYear(db);

  const byProfile = new Map<number, typeof edits>();
  for (const edit of edits) {
    const list = byProfile.get(edit.contributionProfileId) ?? [];
    list.push(edit);
    byProfile.set(edit.contributionProfileId, list);
  }

  for (const [contributionProfileId, profileEdits] of byProfile) {
    const [profile] = await db
      .select()
      .from(schema.contributionProfiles)
      .where(eq(schema.contributionProfiles.id, contributionProfileId));
    if (!profile) continue; // stale FK — nothing to update

    const original = profile.contributionActiveFields as EntityFieldMap;
    let activeFields = original;
    let changed = false;
    for (const edit of profileEdits) {
      const next = mergeContributionAccountEdit(
        activeFields,
        edit.contributionAccountId,
        edit.monthlyAmount,
        periodsPerYear,
        incomplete,
      );
      if (next !== null) {
        activeFields = next;
        changed = true;
      }
    }
    if (!changed) continue;
    await check(db as Db, {
      profileId: contributionProfileId,
      before: original.contributionAccounts ?? {},
      after: activeFields.contributionAccounts ?? {},
      touched: profileEdits.map((e) => e.contributionAccountId),
    });

    await db
      .update(schema.contributionProfiles)
      .set({ contributionActiveFields: activeFields })
      .where(eq(schema.contributionProfiles.id, contributionProfileId));
  }
}
