/** What a person's contribution snapshot is figured from. */
import type { contributionPay } from "@/lib/pure/household/compensation";
import type { ContributionAccountRow } from "./contribution-account-row";

/** contribAccountsFor's input, by name: several of its figures share a
 *  type (salary and total compensation; this year's and last year's IRS
 *  limits), so a positional swap would compile and move a figure. */
export type PersonContributionAccountsInput<R extends ContributionAccountRow> =
  {
    effectiveContributions: R[];
    activeJob: {
      id: number;
      bonusMonth?: number | null;
      bonusDayOfMonth?: number | null;
    };
    person: { id: number; dateOfBirth: string };
    /** The job's contributionPay: base salary and the bonus. */
    pay: ReturnType<typeof contributionPay>;
    asOfDate: Date;
    /** Payroll contribution basis (pay.salary). */
    salary: number;
    periodsPerYear: number;
    /** This year's IRS limits. */
    limitsRecord: Record<string, number>;
    /** Salary plus this year's bonus: the savings rate's denominator. */
    totalCompensation: number;
    /** Age on asOfDate (catch-up limits). */
    age: number;
    /** Last year's IRS limits (prior-year contributions). */
    priorYearLimitsRecord: Record<string, number>;
  };
