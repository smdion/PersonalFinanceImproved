import { isRetirementParent } from "@/lib/config/account-types";
import { safeDivide } from "@/lib/utils/math";
import type { ViewMode } from "@/lib/pure/contributions/view-mode";
import type { ViewAwareTotals } from "./view-metrics";

/** One account's share of a household savings breakdown — the subset of
 * the contribution-summary snapshot the helper below reads. */
type SavingsAccount = {
  parentCategory: string;
  employeeContrib: number;
  tradContrib: number;
  taxFreeContrib: number;
  afterTaxContrib: number;
  hsaContrib: number;
  views: Record<ViewMode, { employeeContrib: number; totalContrib: number }>;
};

/** A person shape sufficient to derive a household savings rate — the
 * subset of the contribution-summary router output the dashboard reads. */
export type SavingsRatePerson = {
  totalCompensation?: number | null;
  salary?: number | null;
  accountTypes: SavingsAccount[];
  totals: {
    views: Record<
      ViewMode,
      Pick<
        ViewAwareTotals,
        | "retirementWithoutMatch"
        | "retirementWithMatch"
        | "portfolioWithoutMatch"
        | "portfolioWithMatch"
        | "compensation"
      >
    >;
  };
};

/** Sum of each person's total compensation (falls back to salary). Compute
 * once and reuse — callers typically need it both to decide `excludeMatch`
 * (via `isHighIncomeHousehold`) and to weight the rate itself. */
export function householdTotalCompensation(
  people: Pick<SavingsRatePerson, "totalCompensation" | "salary">[],
): number {
  return people.reduce((s, d) => s + (d.totalCompensation ?? d.salary ?? 0), 0);
}

/** Household-level "is this a high earner" gate — whether employer match is
 * excluded from the headline savings rate by default. A line not known yet
 * (still loading) is never crossed; surfaces that judge with it wait. */
export function isHighIncomeHousehold(
  householdTotalComp: number,
  highIncomeThreshold: number | undefined,
): boolean {
  return (
    highIncomeThreshold !== undefined &&
    householdTotalComp >= highIncomeThreshold
  );
}

export type SavingsGroup = "retirement" | "portfolio";

const TREATMENTS = [
  ["preTax", "tradContrib"],
  ["taxFree", "taxFreeContrib"],
  ["afterTax", "afterTaxContrib"],
  ["hsa", "hsaContrib"],
] as const;
export type SavingsTreatment = (typeof TREATMENTS)[number][0];

/**
 * The household savings rate for a view, and what it's made of: every
 * person's and every joint account's contributions over the compensation
 * the view divides by (YTD: earned so far), split by goal group
 * (Retirement / Portfolio — parentCategory) and, within each, by tax
 * treatment. Treatments come from the paycheck setup, so each group's split
 * is scaled to the view's employee dollars; the employer match (when
 * included) is its own line. Shares are fractions of compensation, and a
 * group's lines add up to the group.
 */
export function householdSavings(
  people: SavingsRatePerson[],
  jointAccounts: SavingsAccount[],
  viewMode: ViewMode,
  {
    excludeMatch,
    includePortfolio = true,
  }: {
    excludeMatch: boolean;
    /** false: Retirement accounts only (Portfolio money left out of the rate). */
    includePortfolio?: boolean;
  },
) {
  const compensation = people.reduce(
    (s, d) => s + d.totals.views[viewMode].compensation,
    0,
  );
  const share = (n: number) => safeDivide(n, compensation, 0);
  const groupOf = (a: SavingsAccount): SavingsGroup =>
    isRetirementParent(a.parentCategory) ? "retirement" : "portfolio";
  const groups = (["retirement", "portfolio"] as const).map((group) => {
    const persons = people.map((d) => d.totals.views[viewMode]);
    const joint = jointAccounts.filter((a) => groupOf(a) === group);
    const employee =
      persons.reduce((s, v) => s + v[`${group}WithoutMatch`], 0) +
      joint.reduce((s, a) => s + a.views[viewMode].employeeContrib, 0);
    const withMatch =
      persons.reduce((s, v) => s + v[`${group}WithMatch`], 0) +
      joint.reduce((s, a) => s + a.views[viewMode].totalContrib, 0);
    const accounts = [
      ...people.flatMap((d) =>
        d.accountTypes.filter((a) => groupOf(a) === group),
      ),
      ...joint,
    ];
    const plan = accounts.reduce((s, a) => s + a.employeeContrib, 0);
    const scale = safeDivide(employee, plan, 0);
    const lines: { key: SavingsTreatment | "match"; share: number }[] =
      TREATMENTS.map(([key, field]) => ({
        key,
        share: share(accounts.reduce((s, a) => s + a[field], 0) * scale),
      }));
    if (!excludeMatch)
      lines.push({ key: "match", share: share(withMatch - employee) });
    const total = excludeMatch ? employee : withMatch;
    return {
      group,
      total,
      share: share(total),
      lines: lines.filter((l) => l.share > 0),
    };
  });
  const counted = groups.filter(
    (g) => g.total !== 0 && (includePortfolio || g.group !== "portfolio"),
  );
  const total = counted.reduce((s, g) => s + g.total, 0);
  return {
    compensation,
    total,
    rate: share(total),
    groups: counted,
  };
}

export type HouseholdSavings = ReturnType<typeof householdSavings>;
