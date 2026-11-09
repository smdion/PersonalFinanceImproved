"use client";

/**
 * The contribution-accounts panel's mutations, partial-update helpers (handlePerfUpdate,
 * handleContribUpdate) and link helper; the parent owns queries and UI state.
 */

import type {
  EmployerMatchType,
  RothIraRoute,
  TaxTreatment,
} from "@/lib/config/enum-values";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import type { AccountCategory } from "@/lib/config/account-types";
import { resentMatchTerms } from "@/lib/pure/contributions/match-display";
import type { z } from "zod/v4";
import type { contribAccountActiveFieldsPatchSchema } from "@/lib/db/shapes/json-schemas";

type ContributionRecord =
  RouterOutputs["settings"]["contributionAccounts"]["list"][number];

type PerfAccountRecord =
  RouterOutputs["performance"]["performanceAccounts"]["list"][number];

/** Profile-ownable contribution-account fields this page edits; edits route
 *  into the active profile. All other fields have no profile-level fallback
 *  and always write the raw row. */
const PROFILE_OWNED_CONTRIBUTION_FIELDS = [
  "employerMatchType",
  "employerMatchValue",
  "employerMaxMatchPct",
  "autoMaximize",
] as const satisfies readonly (keyof z.infer<
  typeof contribAccountActiveFieldsPatchSchema
>)[];

export function useContributionAccountsMutations({
  allContribs,
  activeContributionProfileId,
}: {
  allContribs: ContributionRecord[];
  /** The globally-effective Contribution Profile id (the active), if any. When set, PROFILE_OWNED_CONTRIBUTION_FIELDS edits route
   *  here instead of the raw account row. */
  activeContributionProfileId?: number | null;
}) {
  const utils = trpc.useUtils();

  const setContributionProfileFieldsMut =
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

  const updateContributionMut =
    trpc.settings.contributionAccounts.update.useMutation({
      onSuccess: () => {
        utils.settings.contributionAccounts.invalidate();
        utils.retirement.invalidate();
        utils.projection.invalidate();
      },
    });

  const createContributionMut =
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
      allowPenalizedWithdrawals: boolean;
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
        : pa.retirementBehavior) as
        | "stops_at_owner_retirement"
        | "stops_when_last_retires"
        | "continues_after_retirement",
      contributionScaling: (updates.contributionScaling !== undefined
        ? updates.contributionScaling
        : pa.contributionScaling) as "scales_with_salary" | "fixed_amount",
      allowPenalizedWithdrawals:
        updates.allowPenalizedWithdrawals !== undefined
          ? updates.allowPenalizedWithdrawals
          : pa.allowPenalizedWithdrawals,
    });
  };

  const handleContribUpdate = (
    c: ContributionRecord,
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
      /** A Roth IRA's route — profile-only (no account column); direct is
       *  stored as absent, as the Paycheck page does. */
      rothRoute: RothIraRoute;
    }>,
  ) => {
    // With a Contribution Profile active, profile-owned fields write into it, as the
    // Paycheck/Budget pages do; a raw-row write would be shadowed by the profile.
    if (activeContributionProfileId != null) {
      // A profile entry is set or absent, never null, so a "clear" edit (blank
      // Match %) is dropped here, and not written to the raw row either, which
      // the profile would shadow.
      const profileFields: Partial<{
        employerMatchType: string;
        employerMatchValue: string | number;
        employerMaxMatchPct: string | number;
        autoMaximize: boolean;
      }> = {};
      for (const field of PROFILE_OWNED_CONTRIBUTION_FIELDS) {
        const value = updates[field];
        if (value !== undefined && value !== null) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (profileFields as any)[field] = value;
        }
      }
      const route = updates.rothRoute;
      if (route === "backdoor")
        (profileFields as { rothRoute?: RothIraRoute }).rothRoute = route;
      const unset = route === "direct" ? ["rothRoute"] : [];
      if (Object.keys(profileFields).length > 0 || unset.length > 0) {
        setContributionProfileFieldsMut.mutate({
          profileId: activeContributionProfileId,
          accountId: c.id,
          fields: profileFields,
          ...(unset.length > 0 ? { unset } : {}),
        });
      }
      // Everything else in `updates` (if any) still falls through to the raw
      // write below — those fields have no profile-level fallback.
      const rest = Object.fromEntries(
        Object.entries(updates).filter(
          ([key]) =>
            !(PROFILE_OWNED_CONTRIBUTION_FIELDS as readonly string[]).includes(
              key,
            ) && key !== "rothRoute",
        ),
      );
      if (Object.keys(rest).length === 0) return;
      updates = rest as typeof updates;
    }
    updateContributionMut.mutate({
      id: c.id,
      personId: updates.personId !== undefined ? updates.personId : c.personId,
      jobId: updates.jobId !== undefined ? updates.jobId : c.jobId,
      accountType: (updates.accountType ?? c.accountType) as AccountCategory,
      taxTreatment: (updates.taxTreatment ?? c.taxTreatment) as TaxTreatment,
      employerMatchType: (updates.employerMatchType ??
        c.employerMatchType) as EmployerMatchType,
      ...resentMatchTerms(updates.employerMatchValue, c),
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
          : c.allocationPriority,
      notes: updates.notes !== undefined ? updates.notes : c.notes,
      isPayrollDeducted:
        updates.isPayrollDeducted !== undefined
          ? updates.isPayrollDeducted
          : c.isPayrollDeducted,
    });
  };

  const handleLinkContribution = (
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
    createContributionMut,
    updatePortfolioAccountMut,
    createPortfolioAccountMut,
    handlePerfUpdate,
    handleContribUpdate,
    handleLinkContribution,
  };
}
