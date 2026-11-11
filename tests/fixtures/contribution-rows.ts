/**
 * Invented contribution rows, jobs and salaries for the contribution
 * calculator tests (category totals, display specs).
 */
import type { AccountCategory } from "@/lib/config/account-types";
import type {
  ContributionMethod,
  EmployerMatchType,
} from "@/lib/config/enum-values";

export function makeContribRow(
  overrides: Partial<{
    id: number;
    personId: number;
    jobId: number | null;
    accountType: AccountCategory;
    subType: string | null;
    label: string | null;
    parentCategory: string;
    contributionMethod: ContributionMethod;
    contributionValue: string;
    taxTreatment: string;
    employerMatchType: EmployerMatchType | null;
    employerMatchValue: string | null;
    employerMaxMatchPct: string | null;
  }> = {},
) {
  return {
    id: 1,
    personId: 1,
    jobId: 1,
    accountType: "401k" as AccountCategory,
    subType: null,
    label: null,
    parentCategory: "Retirement",
    contributionMethod: "percent_of_salary" as ContributionMethod,
    contributionValue: "10",
    taxTreatment: "pre_tax",
    employerMatchType: null as EmployerMatchType | null,
    employerMatchValue: null,
    employerMaxMatchPct: null,
    fromBonus: undefined as boolean | undefined,
    // Rows as the IRS-limit cap pass leaves them (none over a limit here).
    capPassed: true as const,
    ...overrides,
  };
}

export function makeJob(id = 1, personId = 1, payPeriod = "biweekly") {
  return { id, personId, payPeriod };
}

export function makeJobSalary(jobId = 1, personId = 1, salary = 120000) {
  return { job: { id: jobId, personId }, salary };
}
