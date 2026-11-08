/** The contribution account row the paycheck's account inputs are built from. */
import type {
  EmployerMatchType,
  HsaCoverageType,
  MatchTaxTreatment,
  TaxTreatment,
} from "@/lib/config/enum-values";
import type { GroupableMatchRow } from "./employer-match";

/** The fields buildContribAccounts reads from a contribution account once a
 *  profile's active fields apply: the services' resolved rows satisfy it
 *  structurally. The match-group fields are GroupableMatchRow's. */
export type PaycheckContribRow = Pick<
  GroupableMatchRow,
  "id" | "jobId" | "personId" | "accountType" | "parentCategory"
> & {
  subType: string | null;
  label: string | null;
  contributionMethod: string;
  contributionValue: string | number;
  taxTreatment: TaxTreatment;
  employerMatchType: EmployerMatchType;
  employerMatchValue: string | null;
  /** As stored, or as a profile entry merged it (storedMatchRate reads it). */
  employerMatchRate: string | number | null;
  employerMaxMatchPct: string | null;
  employerMatchTaxTreatment: MatchTaxTreatment;
  hsaCoverageType: HsaCoverageType | null;
  /** Paid through payroll; null/absent = when it has a job. */
  isPayrollDeducted?: boolean | null;
  /** Also taken from bonus checks (Contribution Profile election). */
  fromBonus: boolean | undefined;
};
