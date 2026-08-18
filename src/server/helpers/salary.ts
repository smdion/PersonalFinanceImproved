/**
 * Salary lookup and compensation helpers.
 *
 * A job carries no salary/bonus of its own. There are exactly two sources
 * of truth for what someone earns:
 *   - `historical_salaries` — a direct, per-person-per-year fact (past
 *     years), edited on the Historical page. See routers/historical.ts.
 *   - The active Salary Profile's entry for a job — a COMPLETE,
 *     all-or-nothing number for the live/current picture (see
 *     SalaryProfileEntry below). No partial/pinned state, no fallback to
 *     "the job's live value" — a job has none.
 */
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { roundToCents } from "@/lib/utils/math";
import { toNumber } from "./transforms";
import type { Db } from "./transforms";
import { SK_ACTIVE_SALARY_PROFILE_ID } from "@/lib/constants/settings-keys";

// ---------------------------------------------------------------------------
// Plan/session + What-If sandbox tiers — independent of Salary Profiles.
// Both are ephemeral, request-scoped layers on top of whatever a Salary
// Profile resolves to; neither is persisted salary "truth."
// ---------------------------------------------------------------------------

/** A Plan/session or What-If sandbox salary/bonus tweak — genuinely
 *  partial (e.g. "just try a different salary"), unlike a Salary Profile's
 *  own entries. Presence per field is the signal here; absence falls
 *  through to whatever the tier below already resolved. */
export type SalaryOverrideEntry = {
  salary?: number;
  bonusPercent?: number;
  bonusMultiplier?: number;
  monthsInBonusYear?: number;
};

/** personId → the Plan/session tier's active salary override, if any. */
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
 * Merge a Plan/session or What-If sandbox entry's bonus-term overrides onto
 * a Salary Profile's resolved terms — the override tier can adjust
 * bonusPercent/bonusMultiplier/monthsInBonusYear independently of salary,
 * same per-field precedence as applyActiveSalary for the salary field.
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
export function pinnedFields(
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
 * precedence tier, above the Plan/session tier already merged into the map.
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

/**
 * One job's entry in a Salary Profile's `salaries` map. Always complete —
 * a profile either has ALL FOUR of these numbers for a job, or (no key at
 * all) says nothing about it. There is no partial state, no "resolves
 * live," no revert-to-something-else. A profile is its own self-contained
 * world; if you want different numbers, use a different profile.
 *
 * `bonusPercent` is a FRACTION (0.12 = 12%).
 */
export type SalaryProfileEntry = {
  salary: number;
  bonusPercent: number;
  bonusMultiplier: number;
  monthsInBonusYear: number;
};

/** A Salary Profile's own `salaries` map, keyed by jobId (string key) —
 *  a profile targets a specific job's terms. */
export type SalaryEntryMap = Record<string, SalaryProfileEntry>;

/** jobId → that job's complete entry in the active Salary Profile, if any. */
export type SalaryProfileActiveMap = Map<number, SalaryProfileEntry>;

/** The bonus terms computeBonusGross takes, in its own argument types. */
export type BonusTerms = {
  bonusPercent: string | null;
  bonusMultiplier: string | null;
  monthsInBonusYear: number | null;
};

/**
 * THE definition of what one job earns under a Salary Profile: the
 * profile's own complete entry for that job, or nothing at all ($0, no
 * bonus) if the profile doesn't mention it — never a fallback to a job
 * column or a dated ledger, because neither exists any more.
 */
export function resolveCompensation(
  salaryProfileActiveMap: SalaryProfileActiveMap,
  jobId: number,
): { salary: number; bonus: number; totalComp: number; terms: BonusTerms } {
  const entry = salaryProfileActiveMap.get(jobId);
  if (!entry) {
    const terms: BonusTerms = {
      bonusPercent: null,
      bonusMultiplier: null,
      monthsInBonusYear: null,
    };
    return { salary: 0, bonus: 0, totalComp: 0, terms };
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
  };
}

/**
 * Resolve one person's income for a specific year using the same
 * "recorded fact beats live estimate" fallback chain as historical.ts's
 * computeSummary/upsertSalary: a historical_salaries row wins if recorded;
 * otherwise, for the current year only, fall back to the active Salary
 * Profile's complete entry for the person's active job. `recorded` is
 * false only when neither source has anything — callers (e.g.
 * performance.ts's finalizeYear) use that to avoid persisting a false $0.
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
 * Fetch a Salary Profile by id.
 *
 * A null/undefined id means "no Salary Profile selected at this call site"
 * and yields null. A non-null id that doesn't resolve is a genuinely
 * missing row, not a sentinel.
 */
export async function fetchSalaryProfile(
  db: Db,
  salaryProfileId: number | null | undefined,
): Promise<typeof schema.salaryProfiles.$inferSelect | null> {
  if (salaryProfileId == null) return null;
  const rows = await db
    .select()
    .from(schema.salaryProfiles)
    .where(eq(schema.salaryProfiles.id, salaryProfileId));
  return rows[0] ?? null;
}

/**
 * Load a Salary Profile and build its job-targeted active-value map — see
 * SalaryProfileActiveMap. Returns an empty map when the id is null/undefined
 * or the profile no longer exists.
 */
export async function loadAndApplySalaryProfile(
  db: Db,
  salaryProfileId: number | undefined | null,
): Promise<SalaryProfileActiveMap> {
  const profile = await fetchSalaryProfile(db, salaryProfileId);
  return applySalaryProfileRow(profile);
}

/**
 * Same as loadAndApplySalaryProfile, but falls back to the globally-ACTIVE
 * Salary Profile when no explicit id is given — the "viewing a specific
 * profile" callers (Paycheck/Contribution pages) always pass their own
 * resolved id, so this only matters when a caller genuinely has no
 * preference (historical.ts, savings.ts, retirement.ts, helpers/
 * contribution.ts's loadLiveContribData all call this with `null` for
 * exactly that reason — call this instead of hand-rolling the app_settings
 * lookup again). helpers/snapshot.ts's buildYearEndHistory is the one
 * deliberate exception: it already has app_settings batch-fetched as part
 * of a larger Promise.all, so re-deriving the active id from that
 * in-memory array avoids a redundant query on a hot path.
 */
export async function loadEffectiveSalaryProfile(
  db: Db,
  salaryProfileId: number | null | undefined,
): Promise<SalaryProfileActiveMap> {
  if (salaryProfileId != null) {
    return loadAndApplySalaryProfile(db, salaryProfileId);
  }
  const rows = await db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, SK_ACTIVE_SALARY_PROFILE_ID));
  const activeId = Number(rows[0]?.value ?? NaN);
  return Number.isFinite(activeId)
    ? loadAndApplySalaryProfile(db, activeId)
    : new Map();
}

/**
 * Synchronous twin of loadAndApplySalaryProfile for batch-fetched contexts —
 * builds the map from an already-fetched row without issuing a query.
 */
export function applySalaryProfileRow(
  profile: { salaries: SalaryEntryMap | null } | null | undefined,
): SalaryProfileActiveMap {
  const map: SalaryProfileActiveMap = new Map();
  if (!profile) return map;
  const salaries = (profile.salaries ?? {}) as SalaryEntryMap;
  for (const [jobIdKey, entry] of Object.entries(salaries)) {
    map.set(Number(jobIdKey), entry);
  }
  return map;
}

/**
 * Compute effective income for a job — salary + annual bonus when
 * includeBonusInContributions is true. Used for payroll contribution
 * calculations where the flag controls whether percent-of-salary deductions
 * apply to bonus pay.
 */
export function getEffectiveIncome(
  job: { includeBonusInContributions: boolean },
  baseSalary: number,
  bonusTerms: BonusTerms,
): number {
  if (!job.includeBonusInContributions) return baseSalary;
  return getTotalCompensation(baseSalary, bonusTerms);
}

/**
 * Compute total compensation (salary + bonus) regardless of the
 * includeBonusInContributions flag. Used for display and projection
 * purposes where total comp is always the relevant number.
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
  // A stored 0 is a real "no bonus this cycle" value, not "unset" — only
  // null (genuinely no multiplier on record) defaults to 1×. `toNumber`
  // can't distinguish the two (both collapse to 0), so check before
  // converting.
  const mult = bonusMultiplier === null ? 1 : toNumber(bonusMultiplier);
  const months = monthsInBonusYear ?? 12;
  return roundToCents(salary * pct * mult * (months / 12));
}
