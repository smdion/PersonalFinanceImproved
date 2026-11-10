/** A plan row's employer: its job, and the job's gross pay this year (null = unknown). */
export type PlanEmployer = { key: number; pay: number | null };

export type CapRow = {
  id: number;
  /** null = a joint row with no single owner. */
  personId: number | null;
  accountType: string;
  hsaCoverageType: string | null;
  /** Employee money from regular checks over the tax year. */
  regularAnnual: number;
  /** Employee money from bonus checks over the tax year. */
  bonusAnnual: number;
  /** Employer money over the year at the configured contribution (counts toward the limit when
   *  `matchCountsTowardLimit`); CapContext.employerAt, when given, says how it moves with a cut. */
  employerAnnual: number;
  /** Pre-tax payroll money: off the person's W-2 box 1 pay, which bounds an IRA. */
  reducesCompensation: boolean;
  /** The plan's employer and its gross pay; none = no employer known. */
  employer?: PlanEmployer;
};

export type CapPerson = {
  id: number;
  /** null = unknown — capped at the most any age allows. */
  birthYear: number | null;
  /** Taxable pay for the year before pre-tax payroll money (salary, bonus,
   *  other taxable pay); the pass takes off the capped pre-tax rows itself.
   *  null = unknown (no compensation bound). */
  wages: number | null;
};

export type CapContext = {
  taxYear: number;
  filingStatus: string;
  /** Every IRS limit key for the year (base, catch-ups, coverage variants); a projected year's grown. */
  limits: Record<string, number>;
  people: readonly CapPerson[];
  /**
   * Employer money for these rows when their employee money is scaled by
   * `factor` (a match figured on the contribution moves with it). Must not
   * fall as the factor grows. Absent = each row's fixed `employerAnnual`.
   */
  employerAt?: (rowIds: readonly number[], factor: number) => number;
};
