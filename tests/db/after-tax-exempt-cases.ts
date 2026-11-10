/**
 * Invented paycheck deductions for the after-tax-exempt shape (stored-JSON
 * tag, v0106-after-tax-exempt.ts): an after-tax row flagged FICA-exempt
 * loses the flag; every other combination stays.
 */
type DeductionCase = {
  id: number;
  pretax: boolean;
  exempt: boolean;
  after: boolean;
};

/** Each deduction's FICA-exempt flag before and after (job 10). */
export const DEDUCTIONS: DeductionCase[] = [
  { id: 951, pretax: false, exempt: true, after: false },
  { id: 952, pretax: false, exempt: false, after: false },
  { id: 953, pretax: true, exempt: true, after: true },
  { id: 954, pretax: true, exempt: false, after: false },
];

/** Ids the converter writes. */
export const WRITTEN = [951];

/** Each deduction as a database row (booleans as booleans). */
export const deductionRows = () =>
  DEDUCTIONS.map((d) => ({
    id: d.id,
    job_id: 10,
    deduction_name: `Invented ${d.id}`,
    is_pretax: d.pretax,
    fica_exempt: d.exempt,
  }));
