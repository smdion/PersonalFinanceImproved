/**
 * Salary lookup and compensation helpers. A job has no pay of its own: past years
 * come from `historical_salaries`, the current picture from the active Salary
 * Profile's complete entry for the job (SalaryEntry).
 */
import type { SalaryEntry } from "@/lib/db/shapes/salary-entry-defaults";
import { roundToCents } from "@/lib/utils/math";
import { toNumber } from "@/lib/utils/numbers";
import type { BonusTerms } from "@/lib/pure/paycheck/paycheck.types";

// ---------------------------------------------------------------------------
// What-If sandbox tier: a request-scoped layer over the Salary Profile, never saved.
// ---------------------------------------------------------------------------

/** A partial What-If salary/bonus tweak, unlike a Salary Profile entry: each
 *  absent field falls through to what the Salary Profile resolved. */
export type SalaryOverrideEntry = {
  salary?: number;
  bonusPercent?: number;
  bonusMultiplier?: number;
  monthsInBonusYear?: number;
};

/** personId → the What-If sandbox's salary/bonus tweak, if any. */
export type SalaryActiveMap = Map<number, SalaryOverrideEntry>;

/**
 * Apply a salary active-value map to an already-resolved raw salary — the
 * single "final merge" step (`active ?? raw`).
 */
export function applyActiveSalary(
  personId: number,
  rawSalary: number,
  salaryActiveMap: SalaryActiveMap,
): number {
  return salaryActiveMap.get(personId)?.salary ?? rawSalary;
}

/**
 * Merges a What-If entry's bonus terms onto a Salary Profile's resolved terms,
 * per field and independent of salary, like applyActiveSalary.
 */
export function applyActiveBonusTerms(
  entry: SalaryOverrideEntry | undefined,
  terms: BonusTerms,
): BonusTerms {
  return {
    bonusPercent:
      entry?.bonusPercent !== undefined
        ? String(entry.bonusPercent)
        : terms.bonusPercent,
    bonusMultiplier:
      entry?.bonusMultiplier !== undefined
        ? String(entry.bonusMultiplier)
        : terms.bonusMultiplier,
    monthsInBonusYear: entry?.monthsInBonusYear ?? terms.monthsInBonusYear,
  };
}

/**
 * Strip an override entry down to just the fields it actually sets,
 * dropping anything absent, null, or non-finite. Returns undefined when
 * nothing is set.
 */
function pinnedFields(
  entry: SalaryOverrideEntry | null | undefined,
): SalaryOverrideEntry | undefined {
  if (!entry) return undefined;
  const out: SalaryOverrideEntry = {};
  for (const key of [
    "salary",
    "bonusPercent",
    "bonusMultiplier",
    "monthsInBonusYear",
  ] as const) {
    const value = entry[key];
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Apply a What-If sandbox's hand-edited salary/bonus entries as the highest
 * precedence tier, onto whatever is already in the map.
 * Gaps-only, per field.
 */
export function applySandboxSalaryEntries(
  entries: Record<string, SalaryOverrideEntry> | null | undefined,
  salaryActiveMap: SalaryActiveMap,
): SalaryActiveMap {
  if (!entries || Object.keys(entries).length === 0) return salaryActiveMap;
  const map = new Map(salaryActiveMap);
  for (const [personIdKey, rawEntry] of Object.entries(entries)) {
    const pinned = pinnedFields(rawEntry);
    if (!pinned) continue;
    const personId = Number(personIdKey);
    const existing = map.get(personId);
    map.set(personId, existing ? { ...existing, ...pinned } : pinned);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Salary Profile resolution — complete entries, no pinning
// ---------------------------------------------------------------------------

/** A Salary Profile's own `salaries` map, keyed by jobId (string key) —
 *  a profile targets a specific job's terms. */
export type SalaryEntryMap = Record<string, SalaryEntry>;

/** jobId → that job's complete entry in the active Salary Profile, if any. */
export type SalaryProfileActiveMap = Map<number, SalaryEntry>;

/**
 * What one job earns under a Salary Profile: its entry, or $0 if absent.
 * `bonus`/`totalComp` are formula figures (projections grow them); `bonusOverride`
 * comes back unapplied for this-year displays.
 */
export function resolveCompensation(
  salaryProfileActiveMap: SalaryProfileActiveMap,
  jobId: number,
): {
  salary: number;
  bonus: number;
  totalComp: number;
  terms: BonusTerms;
  bonusOverride: number | null;
} {
  const entry = salaryProfileActiveMap.get(jobId);
  if (!entry) {
    const terms: BonusTerms = {
      bonusPercent: null,
      bonusMultiplier: null,
      monthsInBonusYear: null,
    };
    return { salary: 0, bonus: 0, totalComp: 0, terms, bonusOverride: null };
  }
  const terms: BonusTerms = {
    bonusPercent: String(entry.bonusPercent),
    bonusMultiplier: String(entry.bonusMultiplier),
    monthsInBonusYear: entry.monthsInBonusYear,
  };
  const bonus = computeBonusGross(
    entry.salary,
    terms.bonusPercent,
    terms.bonusMultiplier,
    terms.monthsInBonusYear,
  );
  return {
    salary: entry.salary,
    bonus,
    totalComp: entry.salary + bonus,
    terms,
    // A stored entry may lack the key (`undefined`); like `null`, that means no
    // override.
    bonusOverride: entry.bonusOverride ?? null,
  };
}

/**
 * One person's income for a year: their historical_salaries row, else (current
 * year only) the active Salary Profile entry for their active job. `recorded` is
 * false when neither exists, so callers don't persist a false $0.
 */
export function resolvePersonYearIncome(
  year: number,
  currentYear: number,
  historicalRow: { salary: string | null; bonus: string | null } | undefined,
  activeJobId: number | null | undefined,
  salaryProfileActiveMap: SalaryProfileActiveMap,
): { salary: number; bonus: number; recorded: boolean } {
  if (historicalRow) {
    return {
      salary: toNumber(historicalRow.salary),
      bonus: toNumber(historicalRow.bonus),
      recorded: true,
    };
  }
  if (year === currentYear && activeJobId != null) {
    const hasEntry = salaryProfileActiveMap.has(activeJobId);
    const comp = resolveCompensation(salaryProfileActiveMap, activeJobId);
    return { salary: comp.salary, bonus: comp.bonus, recorded: hasEntry };
  }
  return { salary: 0, bonus: 0, recorded: false };
}

/**
 * Synchronous twin of loadAndApplySalaryProfile for batch-fetched contexts —
 * builds the map from an already-fetched row without issuing a query.
 */
export function applySalaryProfileRow(
  profile: { salaries: SalaryEntryMap } | null | undefined,
): SalaryProfileActiveMap {
  const map: SalaryProfileActiveMap = new Map();
  if (!profile) return map;
  for (const [jobIdKey, entry] of Object.entries(profile.salaries)) {
    map.set(Number(jobIdKey), entry);
  }
  return map;
}

/** A job merged with its Salary Profile entry's non-comp fields (not pay,
 *  bonus terms or bonus destination) — every one `undefined` when the job
 *  has no entry (an incomplete/absent state), never a fallback value. */
type JobWithSalaryFields<J> = J & {
  [
    K in keyof Omit<
      SalaryEntry,
      | "salary"
      | "bonusPercent"
      | "bonusMultiplier"
      | "monthsInBonusYear"
      | "bonusOverride"
      | "bonusDestination"
    >
  ]: SalaryEntry[K] | undefined;
};

/**
 * Merges each job with its Salary Profile entry's non-comp fields (pay schedule,
 * W-4, bonus date, extra-paycheck routing, other earnings). A job missing from the
 * map gets them `undefined`: an "incomplete" signal, never a guessed default.
 */
export function mergeSalaryProfileJobFields<J extends { id: number }>(
  jobs: J[],
  salaryProfileActiveMap: SalaryProfileActiveMap,
): JobWithSalaryFields<J>[] {
  return jobs.map((j) => {
    const entry = salaryProfileActiveMap.get(j.id);
    return {
      ...j,
      payPeriod: entry?.payPeriod,
      payWeek: entry?.payWeek,
      anchorPayDate: entry?.anchorPayDate,
      budgetPeriodsPerMonth: entry?.budgetPeriodsPerMonth,
      w4FilingStatus: entry?.w4FilingStatus,
      w4Box2cChecked: entry?.w4Box2cChecked,
      additionalFedWithholding: entry?.additionalFedWithholding,
      bonusMonth: entry?.bonusMonth,
      bonusDayOfMonth: entry?.bonusDayOfMonth,
      extraPaycheckRouting: entry?.extraPaycheckRouting,
      otherEarnings: entry?.otherEarnings,
    };
  });
}

/**
 * A job's pay as contributions see it: base salary (percent-of-pay and match) and
 * bonus (each account's own bonusCheckContribution). Pass `bonusOverride` for
 * this year's figures; omit it for anything projected forward.
 */
export function contributionPay(
  baseSalary: number,
  bonusTerms: BonusTerms,
  bonusOverride?: number | null,
): { salary: number; bonusGross: number } {
  return {
    salary: baseSalary,
    bonusGross:
      bonusOverride ??
      getTotalCompensation(baseSalary, bonusTerms) - baseSalary,
  };
}

/**
 * Compute total compensation (salary + bonus). Used for display and
 * projection purposes where total comp is always the relevant number.
 */
export function getTotalCompensation(
  baseSalary: number,
  bonusTerms: BonusTerms,
): number {
  const bonus = computeBonusGross(
    baseSalary,
    bonusTerms.bonusPercent,
    bonusTerms.bonusMultiplier,
    bonusTerms.monthsInBonusYear,
  );
  return baseSalary + bonus;
}

/**
 * Compute gross bonus amount.
 * Formula: salary × bonusPercent × bonusMultiplier × (monthsInBonusYear / 12).
 */
export function computeBonusGross(
  salary: number,
  bonusPercent: string | null,
  bonusMultiplier: string | null,
  monthsInBonusYear: number | null,
): number {
  const pct = toNumber(bonusPercent);
  if (pct <= 0) return 0;
  // A stored 0 means no bonus; only null defaults to 1×. `toNumber` maps both
  // to 0, so check first.
  const mult = bonusMultiplier === null ? 1 : toNumber(bonusMultiplier);
  const months = monthsInBonusYear ?? 12;
  return roundToCents(salary * pct * mult * (months / 12));
}

/**
 * This year's pay for a job: Salary Profile compensation plus the job's own What-If
 * tweak (whatIfForJob: the current job's only), and the set bonus when there is one.
 * Read by the IRS-limit cap pass. `totalComp` = salary + this year's bonus.
 */
export function thisYearJobPay(
  job: { id: number },
  salaryProfileActiveMap: SalaryProfileActiveMap,
  whatIf: SalaryOverrideEntry | undefined,
) {
  const comp = resolveCompensation(salaryProfileActiveMap, job.id);
  const salary = whatIf?.salary ?? comp.salary;
  const bonusTerms = applyActiveBonusTerms(whatIf, comp.terms);
  const { bonusGross } = contributionPay(
    salary,
    bonusTerms,
    comp.bonusOverride,
  );
  const totalComp =
    comp.bonusOverride != null
      ? salary + comp.bonusOverride
      : getTotalCompensation(salary, bonusTerms);
  return { comp, salary, bonusTerms, bonusGross, totalComp };
}
