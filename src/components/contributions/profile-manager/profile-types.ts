/** The stored shape of contribution_profiles.contribution_active_fields.
 *  No more "jobs" bucket — retired entirely in the Stage B migration. */
export type ActiveFieldsRoot = {
  contributionAccounts?: Record<string, Record<string, unknown>>;
  deductions?: Record<string, Record<string, unknown>>;
};

/** A raw paycheck_deductions row, as returned by settings.deductions.list. */
export type DeductionRow = {
  id: number;
  jobId: number;
  deductionName: string;
  isPretax: boolean;
  ficaExempt: boolean;
};
