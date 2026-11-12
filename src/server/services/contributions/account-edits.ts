import { and, eq, inArray, isNull } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { EntityFieldMap } from "@/lib/db/schema";
import { roundToCents } from "@/lib/utils/math";
import type { ContribSaveChecker } from "@/server/services/contributions/caps";
import { mergeSalaryProfileJobFields } from "@/lib/pure/household/compensation";
import { loadEffectiveSalaryProfile } from "@/server/services/profiles/salary-profile";
import type { DbOrTx, Db } from "@/lib/db";
import { rowPaySchedule } from "@/lib/pure/contributions/row-pay";

/**
 * Inverse of computeAnnualContribution for flat-dollar methods (budget-linked accounts
 * have jobId === null, so percent_of_salary is rejected loudly rather than written as $0).
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
 * Each edited account's pay periods per year (rowPaySchedule; 0 = no schedule applies), from the
 * jobs the globally active Salary Profile pays, so a batch resolves them once.
 */
async function resolvePeriodsPerYearByAccount(
  db: DbOrTx,
  accountIds: number[],
): Promise<Map<number, number>> {
  const [rawActiveJobs, accounts] = await Promise.all([
    db
      .select()
      .from(schema.jobs)
      .where(
        and(isNull(schema.jobs.endDate), eq(schema.jobs.isSpeculative, false)),
      ),
    db
      .select()
      .from(schema.contributionAccounts)
      .where(inArray(schema.contributionAccounts.id, accountIds)),
  ]);
  // A job's pay schedule comes from the globally active Salary Profile, never the
  // Contribution Profile.
  const salaryProfileActiveMap = await loadEffectiveSalaryProfile(db, null);
  const activeJobs = mergeSalaryProfileJobFields(
    rawActiveJobs,
    salaryProfileActiveMap,
  );
  return new Map(
    accounts.map((a) => [a.id, rowPaySchedule(a, activeJobs).periodsPerYear]),
  );
}

/**
 * Pure merge of one edit into a profile's `contributionActiveFields`: the next blob, or
 * `null` when nothing changes (same rounded value, or no active job supplies the pay
 * schedule the method needs). No DB access, so a batch folds through one snapshot.
 */
function mergeContributionAccountEdit(
  activeFields: EntityFieldMap,
  contributionAccountId: number,
  monthlyAmount: number,
  /** Undefined: the account is gone, nothing to update. */
  periodsPerYear: number | undefined,
): EntityFieldMap | null {
  if (periodsPerYear === undefined) return null;
  const accountFields = (activeFields.contributionAccounts?.[
    String(contributionAccountId)
  ] ?? {}) as Record<string, unknown>;

  // No account-level method to fall back to — a not-yet-valued account
  // defaults to fixed_monthly, the exact unit this edit is already in.
  const method =
    (accountFields.contributionMethod as string | undefined) ?? "fixed_monthly";

  // No active job supplies a pay schedule and this isn't a user-facing save that can
  // reject: keep the value rather than write a fabricated number.
  if (periodsPerYear === 0 && method === "fixed_per_period") return null;

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
 * Write-through for a budget-linked account edited as a monthly amount: converts to the
 * account's unit into `contributionProfileId`'s active fields (caller-resolved), skipping
 * same-value writes. For several accounts use `applyContributionAccountEditsBatch`.
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
  await applyContributionAccountEditsBatch(
    db,
    [{ contributionAccountId, monthlyAmount, contributionProfileId }],
    check,
  );
}

/**
 * Budget-linked edits as monthly amounts: one SELECT + one UPDATE per distinct profile,
 * however many edits it gets. `db` should be a transaction when the caller writes other
 * rows in the same request.
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

  const periodsByAccount = await resolvePeriodsPerYearByAccount(
    db,
    edits.map((e) => e.contributionAccountId),
  );

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
        periodsByAccount.get(edit.contributionAccountId),
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
