"use client";

/**
 * useContributionAccountsMutations — extracted from contribution-accounts.tsx (F5, v0.5.3).
 *
 * Owns: the 7 tRPC mutations + the two partial-updater helpers
 * (handlePerfUpdate, handleContribUpdate) + the link-contrib helper.
 * The parent component still owns query calls and UI state.
 */

import { trpc } from "@/lib/trpc";
import type { AccountCategory } from "@/lib/config/account-types";

// Minimal record shapes — hand-rolled so we avoid importing from @/server/*.
// Fields match the tRPC query shapes used in the partial-updater helpers.

type ContribRecord = {
  id: number;
  personId: number | null;
  jobId: number | null;
  accountType: string;
  taxTreatment: string;
  employerMatchType: string;
  employerMatchValue: string | null;
  employerMaxMatchPct: string | null;
  employerMatchTaxTreatment: string;
  hsaCoverageType: string | null;
  autoMaximize: boolean;
  isActive: boolean;
  ownership: string;
  performanceAccountId: number | null;
  targetAnnual: string | null;
  allocationPriority: number | null;
  notes: string | null;
  isPayrollDeducted: boolean | null;
};

type PerfAccountRecord = {
  id: number;
  institution: string;
  accountType: string;
  subType: string | null;
  label: string | null;
  displayName: string | null;
  ownerPersonId: number | null;
  ownershipType: string;
  parentCategory: string;
  isActive: boolean;
  displayOrder: number;
  retirementBehavior: string | null;
  contributionScaling: string | null;
};

/** Contribution-account fields a Contribution Profile can own (see
 *  contribAccountActiveFieldsSchema) that this page also exposes editors
 *  for. Editing one of these routes into the active profile instead of the
 *  raw account row — everything else here (accountType, personId, jobId,
 *  taxTreatment, ownership, isActive, etc.) has no profile-level fallback
 *  and always writes the raw row directly. */
const PROFILE_OWNED_CONTRIB_FIELDS = [
  "employerMatchType",
  "employerMatchValue",
  "employerMaxMatchPct",
  "autoMaximize",
] as const;

export function useContributionAccountsMutations({
  allContribs,
  activeContribProfileId,
}: {
  allContribs: ContribRecord[];
  /** The globally-effective Contribution Profile id (Plan pin -> globally-
   *  active), if any. When set, PROFILE_OWNED_CONTRIB_FIELDS edits route
   *  here instead of the raw account row. */
  activeContribProfileId?: number | null;
}) {
  const utils = trpc.useUtils();

  const setContribProfileFieldsMut =
    trpc.contributionProfile.setAccountActiveFields.useMutation({
      onSuccess: () => {
        utils.contributionProfile.invalidate();
        utils.paycheck.invalidate();
        utils.retirement.invalidate();
        utils.projection.invalidate();
      },
    });

  const updatePerfMut = trpc.performance.performanceAccounts.update.useMutation(
    {
      onSuccess: () => {
        utils.performance.performanceAccounts.invalidate();
        utils.retirement.invalidate();
        utils.projection.invalidate();
        utils.networth.invalidate();
      },
    },
  );

  const createPerfMut = trpc.performance.performanceAccounts.create.useMutation(
    {
      onSuccess: () => {
        utils.performance.performanceAccounts.invalidate();
      },
    },
  );

  const deletePerfMut = trpc.performance.performanceAccounts.delete.useMutation(
    {
      onSuccess: () => utils.performance.performanceAccounts.invalidate(),
    },
  );

  const updateContribMut =
    trpc.settings.contributionAccounts.update.useMutation({
      onSuccess: () => {
        utils.settings.contributionAccounts.invalidate();
        utils.retirement.invalidate();
        utils.projection.invalidate();
      },
    });

  const createContribMut =
    trpc.settings.contributionAccounts.create.useMutation({
      onSuccess: () => {
        utils.settings.contributionAccounts.invalidate();
        utils.retirement.invalidate();
        utils.projection.invalidate();
      },
    });

  const updatePortfolioAccountMut =
    trpc.networth.portfolioSnapshots.updateAccount.useMutation({
      onSuccess: () => {
        utils.networth.portfolioSnapshots.getLatest.invalidate();
        utils.networth.invalidate();
      },
    });

  const createPortfolioAccountMut =
    trpc.networth.portfolioSnapshots.createAccount.useMutation({
      onSuccess: () => {
        utils.networth.portfolioSnapshots.getLatest.invalidate();
        utils.networth.invalidate();
      },
    });

  // ---- Partial-updater helpers ----

  const handlePerfUpdate = (
    pa: PerfAccountRecord,
    updates: Partial<{
      displayName: string | null;
      institution: string;
      accountType: string;
      subType: string | null;
      label: string | null;
      parentCategory: "Retirement" | "Portfolio";
      ownerPersonId: number | null;
      ownershipType: "individual" | "joint";
      retirementBehavior: string;
      contributionScaling: string;
      isActive: boolean;
    }>,
  ) => {
    updatePerfMut.mutate({
      id: pa.id,
      institution: updates.institution ?? pa.institution,
      accountType: (updates.accountType ?? pa.accountType) as AccountCategory,
      subType:
        updates.subType !== undefined ? updates.subType : (pa.subType ?? null),
      label: updates.label !== undefined ? updates.label : (pa.label ?? null),
      displayName:
        updates.displayName !== undefined
          ? updates.displayName
          : (pa.displayName ?? null),
      ownerPersonId:
        updates.ownerPersonId !== undefined
          ? updates.ownerPersonId
          : pa.ownerPersonId,
      ownershipType:
        updates.ownershipType !== undefined
          ? updates.ownershipType
          : (pa.ownershipType as "individual" | "joint"),
      parentCategory:
        updates.parentCategory !== undefined
          ? updates.parentCategory
          : (pa.parentCategory as "Retirement" | "Portfolio"),
      isActive: updates.isActive !== undefined ? updates.isActive : pa.isActive,
      displayOrder: pa.displayOrder,
      retirementBehavior: (updates.retirementBehavior !== undefined
        ? updates.retirementBehavior
        : (pa.retirementBehavior ?? "stops_at_owner_retirement")) as
        | "stops_at_owner_retirement"
        | "stops_when_last_retires"
        | "continues_after_retirement",
      contributionScaling: (updates.contributionScaling !== undefined
        ? updates.contributionScaling
        : (pa.contributionScaling ?? "scales_with_salary")) as
        "scales_with_salary" | "fixed_amount",
    });
  };

  const handleContribUpdate = (
    c: ContribRecord,
    updates: Partial<{
      accountType: string;
      personId: number | null;
      jobId: number | null;
      taxTreatment: string;
      employerMatchType: string;
      employerMatchValue: string | null;
      employerMaxMatchPct: string | null;
      employerMatchTaxTreatment: string;
      hsaCoverageType: string | null;
      autoMaximize: boolean;
      isActive: boolean;
      ownership: "individual" | "joint";
      performanceAccountId: number | null;
      targetAnnual: string | null;
      allocationPriority: number;
      notes: string | null;
      isPayrollDeducted: boolean | null;
    }>,
  ) => {
    // Route profile-owned fields (employer match terms, autoMaximize) into
    // the active Contribution Profile when one is in effect, so an edit made
    // here lands in the same place the Paycheck/Budget pages write to —
    // otherwise this raw write is silently shadowed by the profile's own
    // resolved value everywhere else in the app (see applyContribActiveFields).
    if (activeContribProfileId != null) {
      // contribAccountActiveFieldsSchema has no `null` variant for these
      // fields (a profile entry is either set or absent, never explicitly
      // nulled) — a "clear" edit (e.g. blanking Match %) has no profile-level
      // representation, so it's dropped here rather than sent as an invalid
      // value. It still isn't written to the raw row either, since that
      // would be silently shadowed by whatever the profile already holds.
      const profileFields: Partial<{
        employerMatchType: string;
        employerMatchValue: string | number;
        employerMaxMatchPct: string | number;
        autoMaximize: boolean;
      }> = {};
      for (const field of PROFILE_OWNED_CONTRIB_FIELDS) {
        const value = updates[field];
        if (value !== undefined && value !== null) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (profileFields as any)[field] = value;
        }
      }
      if (Object.keys(profileFields).length > 0) {
        setContribProfileFieldsMut.mutate({
          profileId: activeContribProfileId,
          accountId: c.id,
          fields: profileFields,
        });
      }
      // Everything else in `updates` (if any) still falls through to the raw
      // write below — those fields have no profile-level fallback.
      const rest = Object.fromEntries(
        Object.entries(updates).filter(
          ([key]) =>
            !(PROFILE_OWNED_CONTRIB_FIELDS as readonly string[]).includes(key),
        ),
      );
      if (Object.keys(rest).length === 0) return;
      updates = rest as typeof updates;
    }
    updateContribMut.mutate({
      id: c.id,
      personId: updates.personId !== undefined ? updates.personId : c.personId,
      jobId: updates.jobId !== undefined ? updates.jobId : c.jobId,
      accountType: (updates.accountType ?? c.accountType) as
        "401k" | "403b" | "ira" | "hsa" | "brokerage",
      taxTreatment: (updates.taxTreatment ?? c.taxTreatment) as
        "pre_tax" | "tax_free" | "after_tax" | "hsa",
      employerMatchType: (updates.employerMatchType ?? c.employerMatchType) as
        "none" | "percent_of_contribution" | "dollar_match" | "fixed_annual",
      employerMatchValue:
        updates.employerMatchValue !== undefined
          ? updates.employerMatchValue
          : c.employerMatchValue,
      employerMaxMatchPct:
        updates.employerMaxMatchPct !== undefined
          ? updates.employerMaxMatchPct
          : c.employerMaxMatchPct,
      employerMatchTaxTreatment: (updates.employerMatchTaxTreatment ??
        c.employerMatchTaxTreatment) as "pre_tax" | "tax_free",
      hsaCoverageType: (updates.hsaCoverageType !== undefined
        ? updates.hsaCoverageType
        : c.hsaCoverageType) as "self_only" | "family" | null | undefined,
      autoMaximize:
        updates.autoMaximize !== undefined
          ? updates.autoMaximize
          : c.autoMaximize,
      isActive: updates.isActive !== undefined ? updates.isActive : c.isActive,
      ownership: updates.ownership ?? (c.ownership as "individual" | "joint"),
      performanceAccountId:
        updates.performanceAccountId !== undefined
          ? updates.performanceAccountId
          : c.performanceAccountId,
      targetAnnual:
        updates.targetAnnual !== undefined
          ? updates.targetAnnual
          : c.targetAnnual,
      allocationPriority:
        updates.allocationPriority !== undefined
          ? updates.allocationPriority
          : (c.allocationPriority ?? 0),
      notes: updates.notes !== undefined ? updates.notes : c.notes,
      isPayrollDeducted:
        updates.isPayrollDeducted !== undefined
          ? updates.isPayrollDeducted
          : c.isPayrollDeducted,
    });
  };

  const handleLinkContrib = (
    contribId: number,
    perfAccountId: number | null,
  ) => {
    const c = allContribs.find((x) => x.id === contribId);
    if (!c) return;
    handleContribUpdate(c, { performanceAccountId: perfAccountId });
  };

  return {
    createPerfMut,
    deletePerfMut,
    createContribMut,
    updatePortfolioAccountMut,
    createPortfolioAccountMut,
    handlePerfUpdate,
    handleContribUpdate,
    handleLinkContrib,
  };
}
