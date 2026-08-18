"use client";

/**
 * The one derivation of "what the Paycheck view shows for each person".
 *
 * Extracted from paycheck/page.tsx so the real page and the Budget page's
 * What-If tab share a single computation path: query-input assembly (session
 * -scenario salary overrides included), the two-person aligned deduction
 * rows, the shared contribution group order, and the per-contribution
 * annual/limit data that the contribution cards render.
 *
 * That last one is why this hook exists at all beyond code reuse:
 * `ContributionsSection` used to make its OWN `contribution.computeSummary`
 * query keyed on the RAW globally-active contribution setting while using the
 * Plan-pin-aware hook for the salary axis. On the shipped Paycheck page that
 * meant (a) an active Plan pinning a Contribution Profile was silently
 * ignored by the contribution cards while honored everywhere else on the
 * page, and (b) changing the page's own Contribution Profile dropdown moved
 * the pay-stub numbers but not the cards' annual/limit figures. Contribution
 * data is now resolved ONCE here, with the same ids as the paycheck query,
 * and handed down as a prop. No component below this point queries for it.
 *
 * Naming note: the spec called for `usePaycheckPersonView(personId, …)`. A
 * per-person hook can't be called from the page's `people.map(...)` without
 * breaking the rules of hooks, and the aligned-deduction rows are inherently
 * a two-person derivation, so this returns one view PER PERSON from a single
 * household query instead.
 */

import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useActiveSalaries } from "./use-salary-overrides";
import {
  alignDeductionRows,
  type RawDeduction,
  type RawContrib,
  type DeductionRowData,
  type JointContrib,
} from "@/components/paycheck";
import {
  getLimitGroup as configGetLimitGroup,
  getAccountTypeConfig,
  categoriesWithIrsLimit,
} from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";

const EMPTY_ACTIVE_SALARIES: { personId: number; salary: number }[] = [];

/** Mirrors the server's SalaryEntryMap shape (server/helpers/salary.ts) —
 *  duplicated rather than imported since that file is server-only. */
export type SandboxSalaryEntries = Record<
  string,
  {
    salary?: number;
    bonusPercent?: number;
    bonusMultiplier?: number;
    monthsInBonusYear?: number;
  }
>;

/** Per-contribution computed figures the contribution cards render. */
export type PerContribView = {
  contribId: number;
  annualAmount: number;
  employerMatchAnnual: number;
  limit: number;
  siblingAnnualTotal: number;
  limitGroup: string | null;
};

export type PaycheckPersonView = {
  person: { id: number; name: string };
  /** Narrowed by the hook — every returned view has a job and a paycheck. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- router output shape; the page passes it straight through to props-only components
  job: any;
  salary: number;
  /** The bonus terms actually in effect (Salary Profile pin, if any, else
   *  unset) — a job carries no bonus terms of its own, so this is the only
   *  source to pre-fill from. See paycheck.ts's identical field. */
  resolvedBonusTerms: {
    bonusPercent: number;
    bonusMultiplier: number;
    monthsInBonusYear: number;
    bonusOverride: number | null;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- router output shape
  paycheck: any;
  /** The nominal formula bonus, ignoring any current-year pin — lets the UI
   *  show "target" alongside "actual" when resolvedBonusTerms.bonusOverride
   *  is set. Identical to paycheck.bonusEstimate when no override is set. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- router output shape
  fullFormulaBonusEstimate: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- router output shape
  blendedAnnual: any;
  rawDeductions: RawDeduction[];
  rawContribs: RawContrib[];
  alignedPreTax?: DeductionRowData[];
  alignedPostTax?: DeductionRowData[];
  coverageNote?: string;
  coverageNoteGroup?: string;
  otherJointContribs: JointContrib[];
  activeSalaryValue: number | null;
  /** Already-resolved contribution figures — see the docblock. */
  perContribData: PerContribView[];
};

export type UsePaycheckPersonViewsOptions = {
  contributionProfileId: number | null;
  salaryProfileId: number | null;
  taxYearOverride?: number;
  /**
   * Whether an active session scenario's overrides apply on top.
   *
   * The real Paycheck page passes `true` (today's behavior). The What-If tab
   * passes `false`: a session scenario is a temporary browser-local what-if,
   * a different concept from the tab's own sandbox, and letting it stack on
   * top of the tab's picks would silently show numbers that are neither.
   *
   * `useActiveSalaries` is still *called* unconditionally — React forbids
   * conditional hook calls — but its value is discarded when this is false,
   * so nothing scenario-derived reaches the query input.
   */
  honorSessionScenario: boolean;
  /** The What-If tab's hand-edited salary/bonus entries — sent to BOTH the
   *  paycheck AND contribution queries below (see paycheckRouter's
   *  identical field for why sending it to only one reproduces the
   *  ContributionsSection divergence bug this hook exists to avoid). */
  sandboxSalaryEntries?: SandboxSalaryEntries;
  /** The What-If tab's hand-edited deduction amounts/additions — paycheck
   *  -only (contribution.computeSummary doesn't read deductions at all, so
   *  sending these there would be a no-op input, not a second compute
   *  path). */
  sandboxDeductionEdits?: { id: number; amountPerPeriod: number }[];
  sandboxDeductionAdditions?: {
    personId: number;
    name: string;
    amountPerPeriod: number;
    isPretax: boolean;
  }[];
  /** The What-If tab's hand-edited contribution account values — sent to
   *  BOTH queries (deductions built from contribution accounts feed the
   *  pay stub too, via buildContribAccounts). */
  sandboxContribActiveFields?: Record<string, { contributionValue: string }>;
  /** The What-If tab's hand-added hypothetical contribution accounts — sent
   *  to BOTH queries, same reasoning as sandboxContribActiveFields. */
  sandboxContribAdditions?: {
    personId: number;
    accountType: AccountCategory;
    contributionMethod: "percent_of_salary" | "fixed_annual";
    contributionValue: string;
  }[];
};

export function usePaycheckPersonViews({
  contributionProfileId,
  salaryProfileId,
  taxYearOverride,
  honorSessionScenario,
  sandboxSalaryEntries,
  sandboxDeductionEdits,
  sandboxDeductionAdditions,
  sandboxContribActiveFields,
  sandboxContribAdditions,
}: UsePaycheckPersonViewsOptions) {
  const sessionActiveSalaries = useActiveSalaries();

  // Stable identity: an inline `[]` would be a new array every render and
  // churn every memo below it.
  const salaryActiveFields = useMemo(
    () =>
      honorSessionScenario ? sessionActiveSalaries : EMPTY_ACTIVE_SALARIES,
    [honorSessionScenario, sessionActiveSalaries],
  );

  const queryInput = useMemo(
    () => ({
      ...(salaryActiveFields.length > 0 ? { salaryActiveFields } : {}),
      ...(taxYearOverride ? { taxYearOverride } : {}),
      ...(contributionProfileId != null ? { contributionProfileId } : {}),
      ...(salaryProfileId != null ? { salaryProfileId } : {}),
      ...(sandboxSalaryEntries && Object.keys(sandboxSalaryEntries).length > 0
        ? { sandboxSalaryEntries }
        : {}),
      ...(sandboxDeductionEdits && sandboxDeductionEdits.length > 0
        ? { sandboxDeductionEdits }
        : {}),
      ...(sandboxDeductionAdditions && sandboxDeductionAdditions.length > 0
        ? { sandboxDeductionAdditions }
        : {}),
      ...(sandboxContribActiveFields &&
      Object.keys(sandboxContribActiveFields).length > 0
        ? { sandboxContribActiveFields }
        : {}),
      ...(sandboxContribAdditions && sandboxContribAdditions.length > 0
        ? { sandboxContribAdditions }
        : {}),
    }),
    [
      salaryActiveFields,
      taxYearOverride,
      contributionProfileId,
      salaryProfileId,
      sandboxSalaryEntries,
      sandboxDeductionEdits,
      sandboxDeductionAdditions,
      sandboxContribActiveFields,
      sandboxContribAdditions,
    ],
  );

  const {
    data: rawData,
    isLoading,
    error,
  } = trpc.paycheck.computeSummary.useQuery(
    Object.keys(queryInput).length > 0 ? queryInput : undefined,
    { placeholderData: (prev) => prev },
  );

  // Contribution annual/limit figures, resolved with the SAME profile ids as
  // the paycheck query above — one query for the whole page.
  const { data: contribData } = trpc.contribution.computeSummary.useQuery({
    ...(salaryActiveFields.length > 0 ? { salaryActiveFields } : {}),
    ...(contributionProfileId != null ? { contributionProfileId } : {}),
    ...(sandboxSalaryEntries && Object.keys(sandboxSalaryEntries).length > 0
      ? { sandboxSalaryEntries }
      : {}),
    ...(sandboxContribActiveFields &&
    Object.keys(sandboxContribActiveFields).length > 0
      ? { sandboxContribActiveFields }
      : {}),
    ...(sandboxContribAdditions && sandboxContribAdditions.length > 0
      ? { sandboxContribAdditions }
      : {}),
    ...(salaryProfileId != null ? { salaryProfileId } : {}),
  });

  // NOTE: session-scenario overrides on job/deduction/contribution-account
  // fields used to be re-applied here client-side via `getOverride("jobs" |
  // "deductions" | "contributionAccounts", ...)`. That was dead code: the
  // only writer of a session-scenario override anywhere in the app writes
  // entity "people", field "salary" (paycheck/page.tsx's toggleSalaryOverride)
  // — a different entity than any of the keys this block ever read, so
  // every `getOverride` call here always returned its fallback. The one
  // override that's actually real (salary, per person) already reaches the
  // server correctly via `salaryActiveFields` in `queryInput` above and a real
  // recompute — it never needed this client-side patch. Removed rather than
  // kept as a misleading no-op.
  const people = useMemo(
    () => (rawData?.people ?? []).filter((d) => d.paycheck && d.job),
    [rawData?.people],
  );

  // Aligned deduction rows + HSA-family coverage notes (2-person households).
  const alignedData = useMemo(() => {
    if (people.length !== 2) return null;
    const [p0, p1] = people;
    if (!p0?.paycheck || !p1?.paycheck) return null;

    const d0 = p0.rawDeductions as RawDeduction[];
    const d1 = p1.rawDeductions as RawDeduction[];

    const preTaxAligned = alignDeductionRows(
      p0.paycheck.preTaxDeductions,
      d0,
      p1.paycheck.preTaxDeductions,
      d1,
      p0.job!.id,
      p1.job!.id,
    );
    const postTaxAligned = alignDeductionRows(
      p0.paycheck.postTaxDeductions,
      d0,
      p1.paycheck.postTaxDeductions,
      d1,
      p0.job!.id,
      p1.job!.id,
    );

    const c0 = p0.rawContribs as RawContrib[];
    const c1 = p1.rawContribs as RawContrib[];
    const coverageVariantCategories = categoriesWithIrsLimit().filter(
      (cat) => getAccountTypeConfig(cat).irsLimitKeys?.coverageVariant != null,
    );

    type CoverageNote = { note: string; group: string } | undefined;
    let coverageNote0: CoverageNote;
    let coverageNote1: CoverageNote;

    for (const cat of coverageVariantCategories) {
      const cfg = getAccountTypeConfig(cat);
      const group = cfg.irsLimitGroup ?? cat;
      const label = cfg.displayLabel;

      const p0Family = c0.find(
        (c) => c.accountType === cat && c.hsaCoverageType === "family",
      );
      const p1Family = c1.find(
        (c) => c.accountType === cat && c.hsaCoverageType === "family",
      );
      const p0Has = c0.some((c) => c.accountType === cat);
      const p1Has = c1.some((c) => c.accountType === cat);

      if (p1Family && !p0Has) {
        coverageNote0 = {
          note: `${label} (Family — via ${p1.person.name})`,
          group,
        };
      }
      if (p0Family && !p1Has) {
        coverageNote1 = {
          note: `${label} (Family — via ${p0.person.name})`,
          group,
        };
      }
    }

    return {
      preTax: [preTaxAligned.left, preTaxAligned.right] as const,
      postTax: [postTaxAligned.left, postTaxAligned.right] as const,
      coverageNotes: [coverageNote0, coverageNote1] as const,
    };
  }, [people]);

  // Shared contribution group order so both people's cards line up.
  const sharedContribGroupOrder = useMemo(() => {
    const getGroupKey = (type: string) =>
      configGetLimitGroup(type as AccountCategory) ?? type;
    const order: string[] = [];
    for (const d of people) {
      for (const c of d.rawContribs as RawContrib[]) {
        const key = getGroupKey(c.accountType);
        if (!order.includes(key)) order.push(key);
      }
    }
    for (const jc of rawData?.jointContribs ?? []) {
      const key = getGroupKey(jc.accountType);
      if (!order.includes(key)) order.push(key);
    }
    return order;
  }, [people, rawData?.jointContribs]);

  const jointContribs: JointContrib[] = useMemo(
    () =>
      (rawData?.jointContribs ?? []).map((c) => ({
        id: c.id,
        accountType: c.accountType as AccountCategory,
        subType: c.subType ?? null,
        label: c.label ?? null,
        contributionValue: String(c.contributionValue ?? "0"),
        contributionMethod: c.contributionMethod,
        taxTreatment: c.taxTreatment,
        ownerName: "Joint",
      })),
    [rawData?.jointContribs],
  );

  const views: PaycheckPersonView[] = useMemo(
    () =>
      people.map((d, index) => {
        const personContrib = contribData?.people.find(
          (p) => p.person.id === d.person.id,
        );
        return {
          person: d.person,
          job: d.job!,
          salary: d.salary,
          resolvedBonusTerms:
            "resolvedBonusTerms" in d
              ? d.resolvedBonusTerms
              : {
                  bonusPercent: 0,
                  bonusMultiplier: 1,
                  monthsInBonusYear: 12,
                  bonusOverride: null,
                },
          paycheck: d.paycheck!,
          fullFormulaBonusEstimate: (d as Record<string, unknown>)
            .fullFormulaBonusEstimate,
          blendedAnnual: (d as Record<string, unknown>).blendedAnnual,
          rawDeductions: d.rawDeductions as RawDeduction[],
          rawContribs: d.rawContribs as RawContrib[],
          alignedPreTax: alignedData?.preTax[index as 0 | 1],
          alignedPostTax: alignedData?.postTax[index as 0 | 1],
          coverageNote: alignedData?.coverageNotes[index as 0 | 1]?.note,
          coverageNoteGroup: alignedData?.coverageNotes[index as 0 | 1]?.group,
          otherJointContribs: jointContribs,
          activeSalaryValue:
            salaryActiveFields.find((o) => o.personId === d.person.id)
              ?.salary ?? null,
          perContribData: (personContrib?.perContribData ??
            []) as PerContribView[],
        };
      }),
    [people, contribData, alignedData, jointContribs, salaryActiveFields],
  );

  return {
    views,
    rawData,
    isLoading,
    error,
    sharedContribGroupOrder,
    salaryActiveFields,
  };
}
