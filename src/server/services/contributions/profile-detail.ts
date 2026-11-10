import type { Db } from "@/lib/db";
import type { RequestScope } from "@/server/data/request-scope";
import { isPaidThroughPayroll } from "@/lib/pure/paycheck/bonus";
import { eq } from "drizzle-orm";
import { taxTreatmentToShortLabel } from "@/lib/config/display-labels";
import * as schema from "@/lib/db/schema";
import { readContributionActiveFields } from "@/lib/db/stored-active-fields";
import { loadLiveContribData } from "@/server/services/contributions/live-data";
import { resolveProfile } from "@/server/services/contributions/profile";
import { portfolioAccountLabel } from "@/lib/pure/accounts/portfolio-labels";

export async function loadContributionProfileDetail(
  ctx: { db: Db; scope: RequestScope },
  input: { id: number },
) {
  const rows = await ctx.db
    .select()
    .from(schema.contributionProfiles)
    .where(eq(schema.contributionProfiles.id, input.id));
  const profile = rows[0];
  if (!profile) return null;

  const {
    contribs,
    jobs,
    jobSalaries,
    rawContribRows,
    peopleMap,
    perfAccountMap,
    salaryProfileActiveMap,
  } = await loadLiveContribData(ctx.db, ctx.scope.asOf);
  // portfolioAccountLabel wants id → name; peopleMap here is id → full row.
  const nameMap = new Map(
    Array.from(peopleMap.values(), (p) => [p.id, p.name] as const),
  );
  const resolved = resolveProfile(
    profile,
    contribs,
    jobs,
    jobSalaries,
    salaryProfileActiveMap,
  );

  // Build per-account detail for the editor UI
  const {
    contributionAccounts: accountActiveFields,
    deductions: deductionActiveFields,
  } = readContributionActiveFields(
    profile.contributionActiveFields,
    profile.id,
  );

  const accountDetails = rawContribRows.map((row) => {
    const activeFields = accountActiveFields[String(row.id)];

    // Resolve linked performance account via explicit FK (primary path)
    const perfAccount = row.performanceAccountId
      ? (perfAccountMap.get(row.performanceAccountId) ?? null)
      : null;

    // Derive institution: perf account link → person's job employer → fallback empty
    const institution =
      perfAccount?.institution ??
      jobs.find(
        (j) => j.personId === row.personId && !j.endDate && !j.isSpeculative,
      )?.employerName ??
      "";

    // A row with its own personId gets its owner's label even under a jointly
    // tracked account (as in compareData; rule in portfolio-labels.ts).
    const accountName = portfolioAccountLabel(
      {
        accountType: row.accountType,
        subType: row.subType,
        label: row.label,
        institution,
      },
      perfAccount
        ? {
            displayName: perfAccount.displayName,
            accountLabel: perfAccount.accountLabel,
            ownershipType: perfAccount.ownershipType,
          }
        : undefined,
      row.personId,
      nameMap,
    );

    // Disambiguate when multiple contrib accounts share the same display name
    // (e.g., Trad vs Roth 401k) by appending tax treatment
    const taxLabel = taxTreatmentToShortLabel(row.taxTreatment);
    const sameName = rawContribRows.filter((r) => {
      if (r.id === row.id) return false;
      // Same person + same account type = siblings that need disambiguation
      return r.personId === row.personId && r.accountType === row.accountType;
    });
    const disambiguatedName =
      sameName.length > 0 ? `${accountName} — ${taxLabel}` : accountName;

    const displayNameCustom = activeFields?.displayNameCustom as
      string | undefined;

    return {
      id: row.id,
      accountType: row.accountType,
      subType: row.subType,
      label: row.label,
      accountName: displayNameCustom || disambiguatedName,
      liveAccountName: disambiguatedName,
      personId: row.personId,
      taxTreatment: row.taxTreatment,
      parentCategory: row.parentCategory,
      // Live values: no method or value (only a profile's entry has
      // them; see applyContribActiveFields).
      liveMatchType: row.employerMatchType,
      liveMatchValue: row.employerMatchValue,
      liveMatchRate: row.employerMatchRate,
      liveMaxMatchPct: row.employerMaxMatchPct,
      liveIsActive: row.isActive,
      /** Paid through payroll — only these can be taken from bonus checks. */
      liveIsPayroll: isPaidThroughPayroll(row),
      // Active values — null means this profile has no value at all for
      // this account (isIncomplete), not "falls back to a live value".
      activeFields: activeFields ?? null,
      isIncomplete: activeFields == null,
    };
  });

  // Deductions have no live value of their own: exclude-if-absent, like a
  // contribution account's contributionValue (see applyDeductionActiveFields).
  const allDeductions = await ctx.db.select().from(schema.paycheckDeductions);
  const deductionDetails = allDeductions.map((d) => {
    const activeFields = deductionActiveFields[String(d.id)];
    const job = jobs.find((j) => j.id === d.jobId);
    return {
      id: d.id,
      jobId: d.jobId,
      employerName: job?.employerName ?? null,
      deductionName: d.deductionName,
      isPretax: d.isPretax,
      ficaExempt: d.ficaExempt,
      activeFields: activeFields ?? null,
      isIncomplete: activeFields?.amountPerPeriod === undefined,
    };
  });

  return {
    ...profile,
    createdAt: profile.createdAt.toISOString(),
    accountDetails,
    deductionDetails,
    resolved: {
      combinedSalary: resolved.combinedSalary,
    },
  };
}
