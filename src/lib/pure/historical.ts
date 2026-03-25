/**
 * Pure business logic for historical data temporal resolution.
 * Extracted from historical router — no DB or I/O dependency.
 */
import { toNumber } from "@/server/helpers/transforms";

/** A job's salary change record. */
export type SalaryChange = {
  effectiveDate: string;
  newSalary: number;
};

/** A job timeline entry. */
export type JobTimeline = {
  startDate: string;
  endDate: string | null;
  salary: number;
  changes: SalaryChange[];
};

/**
 * Resolve which salary was effective for a job in a given year.
 * Walks through salary changes in order — the last change with effectiveDate <= year applies.
 */
export function resolveSalaryForYear(job: JobTimeline, year: number): number {
  let salary = job.salary;
  for (const ch of job.changes) {
    const changeYear = parseInt(ch.effectiveDate.slice(0, 4), 10);
    if (changeYear <= year) {
      salary = ch.newSalary;
    }
  }
  return salary;
}

/**
 * Build the salary-by-year lookup for a set of job timelines.
 * Returns a Map of year → Map of personName → salary.
 */
export function buildSalaryByYear(
  people: { personName: string; timeline: JobTimeline[] }[],
): Map<number, Map<string, number>> {
  const result = new Map<number, Map<string, number>>();
  for (const person of people) {
    for (const job of person.timeline) {
      const startYear = parseInt(job.startDate.slice(0, 4), 10);
      const endYear = job.endDate
        ? parseInt(job.endDate.slice(0, 4), 10)
        : new Date().getFullYear();
      for (let y = startYear; y <= endYear; y++) {
        if (!result.has(y)) result.set(y, new Map());
        result.get(y)!.set(person.personName, resolveSalaryForYear(job, y));
      }
    }
  }
  return result;
}

/** An other-asset item from the DB. */
export type OtherAssetItem = {
  name: string;
  year: number;
  value: string | null;
  note: string | null;
};

/**
 * Resolve the carry-forward value for a named asset at a given year.
 * Uses the most recent entry at-or-before the target year. Returns null if no entry or value is 0.
 */
export function resolveCarryForwardAssetValue(
  items: OtherAssetItem[],
  name: string,
  year: number,
): { value: number; note: string | null } | null {
  const entries = items.filter((a) => a.name === name && a.year <= year);
  if (entries.length === 0) return null;
  // Items are already sorted by year asc — take the last one
  const latest = entries[entries.length - 1]!;
  const val = toNumber(latest.value);
  if (val <= 0) return null;
  return { value: val, note: latest.note };
}

/**
 * Resolve all other assets for a given year using carry-forward logic.
 * Returns items with positive values and the total.
 */
export function resolveOtherAssetsForYear(
  allAssets: OtherAssetItem[],
  year: number,
): {
  items: { name: string; value: number; note: string | null }[];
  total: number;
} {
  const uniqueNames = Array.from(new Set(allAssets.map((a) => a.name)));
  const items: { name: string; value: number; note: string | null }[] = [];
  for (const name of uniqueNames) {
    const resolved = resolveCarryForwardAssetValue(allAssets, name, year);
    if (resolved) {
      items.push({ name, value: resolved.value, note: resolved.note });
    }
  }
  return { items, total: items.reduce((s, i) => s + i.value, 0) };
}

/**
 * Compute cumulative home improvement costs up to a given year.
 */
export function computeHomeImpCumulative(
  items: { year: number; cost: string | null }[],
  upToYear: number,
): number {
  return items
    .filter((hi) => hi.year <= upToYear)
    .reduce((sum, hi) => sum + toNumber(hi.cost), 0);
}
