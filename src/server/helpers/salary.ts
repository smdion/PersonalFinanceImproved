/**
 * Salary lookup and compensation helpers.
 */
import { eq, and, lte, gte, gt, desc, asc, inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { roundToCents } from "@/lib/utils/math";
import { toNumber } from "./transforms";
import type { Db } from "./transforms";

/**
 * Get the current salary for a job by checking salary_changes first,
 * falling back to jobs.annual_salary if no changes exist.
 * Per Migration Plan section 12.27.
 */
export async function getCurrentSalary(
  db: Db,
  jobId: number,
  fallbackSalary: string,
  asOfDate: Date = new Date(),
): Promise<number> {
  const changes = await db
    .select()
    .from(schema.salaryChanges)
    .where(
      and(
        eq(schema.salaryChanges.jobId, jobId),
        lte(
          schema.salaryChanges.effectiveDate,
          asOfDate.toISOString().slice(0, 10),
        ),
      ),
    )
    .orderBy(desc(schema.salaryChanges.effectiveDate))
    .limit(1);

  if (changes.length > 0 && changes[0]) {
    return toNumber(changes[0].newSalary);
  }
  return toNumber(fallbackSalary);
}

/**
 * Apply a salary active-value map to an already-resolved raw salary — the
 * single "final merge" step (`active ?? raw`) that used to be re-typed
 * inline at every call site. Use this when the caller already has the raw
 * salary in hand for another purpose (e.g. also needs the inactive/live
 * value for total-compensation math); use resolveEffectiveSalary below when
 * it doesn't and would otherwise fetch it just to throw it away.
 *
 * The map itself should already be the merged Plan+Salary-Profile map from
 * loadAndApplySalaryProfile (Plan wins if both are set) — this function
 * doesn't decide Plan vs. Profile precedence, only applies whatever map it's
 * handed. Contribution Profiles no longer carry salary at all; salary lives
 * on its own first-class Salary Profile entity.
 *
 * Reads ONLY the entry's `salary` field. A person whose profile entry pins
 * bonus terms but no salary has a map entry, so `map.has(personId)` is true,
 * yet their salary must still resolve live — which is exactly what
 * `?? rawSalary` does here. Never re-derive "is this person's salary pinned"
 * from `.has()`; ask for `.get(personId)?.salary !== undefined`.
 *
 * Whether a call site should PASS a populated map at all is a separate
 * decision: pass one when the output is presented as "what your finances
 * look like under the active Plan" (paycheck, budget item $ amounts); pass
 * an empty map when the output is a persisted snapshot or the live/control
 * arm of a comparison (see savings.ts's computeJobNetPayPerCheck,
 * retirement.ts's computeRelocationAnalysis, and this file's
 * loadLiveContribData for documented examples of the latter — overriding
 * those would corrupt what they're for, not fix them).
 */
export function applyActiveSalary(
  personId: number,
  rawSalary: number,
  salaryActiveMap: SalaryActiveMap,
): number {
  return salaryActiveMap.get(personId)?.salary ?? rawSalary;
}

// ---------------------------------------------------------------------------
// Salary Profile resolution
// ---------------------------------------------------------------------------

/**
 * One person's entry in a Salary Profile's `salaries` map.
 *
 * There is no discriminator. PRESENCE OF A FIELD IS THE PIN SIGNAL: a field
 * that is set pins that value for this profile, a field that is absent
 * resolves live from the job record on every read. An empty object (or no
 * key for the person at all) means nothing is pinned for them, which is why
 * a profile does not have to hold an entry for everyone to be complete.
 *
 * The fields are independent. Pinning `salary` says nothing about bonus:
 * a person can pin a salary and keep live bonus terms, pin bonus terms and
 * keep a live salary, or pin both. Code that treats "salary is pinned" as
 * "bonus is gone" is the shape of bug this encoding exists to make
 * unrepresentable — see resolveCompensation below, the single definition of
 * what a person earns under a profile.
 *
 * `bonusPercent` is a FRACTION (0.12 = 12%), matching jobs.bonus_percent.
 */
export type SalaryProfileEntry = {
  salary?: number;
  bonusPercent?: number;
  bonusMultiplier?: number;
  monthsInBonusYear?: number;
};

/** personId (as a string key) → salary entry. */
export type SalaryEntryMap = Record<string, SalaryProfileEntry>;

/**
 * personId → the pinned fields in effect for that person, merged across the
 * Plan/session tier and the Salary Profile tier.
 *
 * A key exists only when SOMETHING is pinned, so `.has(personId)` means
 * "this person has at least one pin" — it does NOT mean their salary is
 * pinned. Ask `.get(personId)?.salary !== undefined` for that specific
 * question, and `?.bonusPercent !== undefined` (etc.) for bonus terms.
 */
export type SalaryActiveMap = Map<number, SalaryProfileEntry>;

/** The bonus terms computeBonusGross takes, in its own argument types. */
export type BonusTerms = {
  bonusPercent: string | null;
  bonusMultiplier: string | null;
  monthsInBonusYear: number | null;
};

/** A job's permanent bonus terms — the live values a profile pin overlays. */
type JobBonusFields = {
  bonusPercent: string | null;
  bonusMultiplier: string | null;
  monthsInBonusYear: number | null;
};

/**
 * Strip an entry down to just the fields it actually pins, dropping anything
 * absent, null, or non-finite. Returns undefined when nothing is pinned.
 *
 * This is the gate that keeps the active map's presence contract honest:
 * an entry that pins nothing must produce NO key, because a key that exists
 * but pins nothing would read as active at every `.has()` call site while
 * carrying no value to apply.
 */
export function pinnedFields(
  entry: SalaryProfileEntry | null | undefined,
): SalaryProfileEntry | undefined {
  if (!entry) return undefined;
  const out: SalaryProfileEntry = {};
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
 * Narrow a Salary Profile's `salaries` map down to just the people whose
 * SALARY is pinned, as a plain personId → number record.
 *
 * This is deliberately lossy in exactly one direction: an entry with no
 * `salary` key produces NO key here. Everything downstream keys off presence
 * (`record[personId] !== undefined`) to mean "this person has an explicit
 * flat salary", so emitting a key for someone whose salary resolves live
 * would silently:
 *   - replace their real, dated salary history with a frozen number in
 *     paycheck/budget/contribution math,
 *   - feed the retirement profile-switch growth math the wrong base to
 *     compound from,
 *   - and (before the presence encoding) zero their bonus outright.
 * Keeping unpinned people out by construction is what lets every one of
 * those consumers stay exactly as it was.
 *
 * Bonus terms are NOT collapsed here — they are not expressible as a single
 * number and travel on the entry itself. Use resolveCompensation.
 */
export function pinnedSalaries(
  salaries: SalaryEntryMap | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [personId, entry] of Object.entries(salaries ?? {})) {
    const salary = pinnedFields(entry)?.salary;
    if (salary !== undefined) out[personId] = salary;
  }
  return out;
}

/**
 * Overlay a profile entry's pinned bonus terms onto a job's live ones.
 * Absent fields fall through to the job record — the whole point of the
 * presence encoding.
 *
 * Numbers are stringified because that is how jobs.bonus_percent /
 * bonus_multiplier arrive from the driver (numeric columns), and
 * computeBonusGross parses both the same way.
 */
export function resolveBonusTerms(
  job: JobBonusFields,
  entry: SalaryProfileEntry | null | undefined,
): BonusTerms {
  return {
    bonusPercent:
      entry?.bonusPercent !== undefined
        ? String(entry.bonusPercent)
        : job.bonusPercent,
    bonusMultiplier:
      entry?.bonusMultiplier !== undefined
        ? String(entry.bonusMultiplier)
        : job.bonusMultiplier,
    monthsInBonusYear:
      entry?.monthsInBonusYear !== undefined
        ? entry.monthsInBonusYear
        : job.monthsInBonusYear,
  };
}

/**
 * THE definition of what one person earns under a Salary Profile entry:
 * pinned-or-live salary, plus a bonus computed from pinned-or-live bonus
 * terms AT THAT SALARY.
 *
 * Every consumer that reports or computes compensation under a profile goes
 * through this — resolveProfile's salary merge, build-engine-payload's
 * per-job comp, and the salary-profile router's own editor preview. They
 * used to each re-derive it, and they disagreed: the router included bonus
 * for a pinned salary while resolveProfile dropped it, so a pinned salary
 * silently lost its bonus from every contribution and projection number
 * while the editor kept showing it. Keeping the arithmetic in one function
 * is what makes those two agree by construction rather than by review.
 *
 * `resolvedBonusOverride` is this year's actual-bonus pin from
 * job_bonus_overrides (null when there is none) and, per computeBonusGross,
 * short-circuits the formula entirely when set.
 */
export function resolveCompensation(
  job: JobBonusFields,
  liveSalary: number,
  entry: SalaryProfileEntry | null | undefined,
  resolvedBonusOverride: number | null,
): { salary: number; bonus: number; totalComp: number; terms: BonusTerms } {
  const salary = entry?.salary ?? liveSalary;
  const terms = resolveBonusTerms(job, entry);
  const bonus = computeBonusGross(
    salary,
    terms.bonusPercent,
    terms.bonusMultiplier,
    resolvedBonusOverride,
    terms.monthsInBonusYear,
  );
  return { salary, bonus, totalComp: salary + bonus, terms };
}

/**
 * Fetch a Salary Profile by id.
 *
 * A null/undefined id means "no Salary Profile selected at this call site"
 * (e.g. a Plan that pins nothing) and yields null. A non-null id that
 * doesn't resolve is a genuinely missing row, not a sentinel — there is no
 * synthetic "Live" id any more.
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
 * Merge a Salary Profile's pinned per-person fields into an existing salary
 * active-value map — GAPS ONLY. Fields already in the map (the Plan/session
 * tier's active values, the highest-precedence tier) always win, matching
 * applyActiveSalary's precedence contract.
 *
 * No-op (returns the map unchanged) when the id is null/undefined or the
 * profile no longer exists.
 */
export async function loadAndApplySalaryProfile(
  db: Db,
  salaryProfileId: number | undefined | null,
  salaryActiveMap: SalaryActiveMap,
): Promise<SalaryActiveMap> {
  const profile = await fetchSalaryProfile(db, salaryProfileId);
  return applySalaryProfileRow(profile, salaryActiveMap);
}

/**
 * Synchronous twin of loadAndApplySalaryProfile for batch-fetched contexts
 * (mirrors applyContribProfileRow) — applies an already-fetched row without
 * issuing a query.
 *
 * INVARIANT: only entries that actually pin something are written into the
 * map. A person whose entry is empty (or absent) is left absent, so a map
 * key keeps meaning "this person has at least one pin" everywhere
 * downstream. See pinnedSalaries' docblock for what breaks if that is
 * violated.
 *
 * The gaps-only merge is PER FIELD, not per person. The Plan/session tier
 * only ever sets an active salary, so a per-person merge would make a
 * Plan's active salary silently discard the profile's pinned bonus terms
 * for that same person — the pins are independent facts and each falls to
 * the highest tier that sets it.
 */
export function applySalaryProfileRow(
  profile: { salaries: SalaryEntryMap | null } | null | undefined,
  salaryActiveMap: SalaryActiveMap,
): SalaryActiveMap {
  if (!profile) return salaryActiveMap;
  const map = new Map(salaryActiveMap);
  const salaries = (profile.salaries ?? {}) as SalaryEntryMap;
  for (const [personIdKey, rawEntry] of Object.entries(salaries)) {
    const pinned = pinnedFields(rawEntry);
    if (!pinned) continue;
    const personId = Number(personIdKey);
    const existing = map.get(personId);
    // Spread order is the precedence: whatever the higher tier already set
    // overwrites the profile's value for that field only.
    map.set(personId, existing ? { ...pinned, ...existing } : pinned);
  }
  return map;
}

/**
 * Apply a What-If sandbox's hand-edited salary/bonus entries as the NEW
 * HIGHEST tier, above everything already merged into the map.
 *
 * Full precedence once this has run (highest first):
 *   sandbox entry (per field) > Plan/session active salary (salary only)
 *   > Salary Profile pin > live job record.
 *
 * There is deliberately no second merge implementation here. The gaps-only
 * merge in applySalaryProfileRow ("whatever the higher tier already set wins,
 * per field") is exactly the rule needed — with the ROLES SWAPPED: the
 * sandbox seeds the map (it's the higher tier now) and the already-resolved
 * lower tiers are handed in as the synthetic "profile row" that only fills
 * fields the sandbox left alone. Writing a bespoke merge here is how the two
 * would drift apart.
 *
 * `entries` is user-supplied (it comes straight off a form), so it goes
 * through pinnedFields like every other source — an empty/NaN/non-finite
 * field pins nothing and falls through to the tier below, and a person whose
 * entry pins nothing produces no key at all, preserving the map's
 * "a key means at least one pin" invariant.
 */
export function applySandboxSalaryEntries(
  entries: SalaryEntryMap | null | undefined,
  salaryActiveMap: SalaryActiveMap,
): SalaryActiveMap {
  if (!entries || Object.keys(entries).length === 0) return salaryActiveMap;
  const sandboxMap: SalaryActiveMap = new Map();
  for (const [personIdKey, rawEntry] of Object.entries(entries)) {
    const pinned = pinnedFields(rawEntry);
    if (pinned) sandboxMap.set(Number(personIdKey), pinned);
  }
  if (sandboxMap.size === 0) return salaryActiveMap;
  const lowerTiers: SalaryEntryMap = {};
  for (const [personId, entry] of salaryActiveMap) {
    lowerTiers[String(personId)] = entry;
  }
  return applySalaryProfileRow({ salaries: lowerTiers }, sandboxMap);
}

/**
 * Resolve a job's effective salary end to end: fetches the raw current
 * salary (salary_changes history, falling back to jobs.annual_salary) and
 * applies applyActiveSalary to it. See applyActiveSalary's docblock for
 * the full precedence contract and when a call site should/shouldn't pass
 * a populated active-value map.
 */
export async function resolveEffectiveSalary(
  db: Db,
  job: { id: number; personId: number; annualSalary: string },
  salaryActiveMap: SalaryActiveMap,
  asOfDate: Date = new Date(),
): Promise<number> {
  const raw = await getCurrentSalary(db, job.id, job.annualSalary, asOfDate);
  return applyActiveSalary(job.personId, raw, salaryActiveMap);
}

/**
 * Fetch current salary + effective income for a list of jobs.
 * Replaces the duplicated `Promise.all(jobs.map(j => getCurrentSalary(...)))` pattern
 * across paycheck, contribution, networth, retirement, and historical routers.
 */
export async function getSalariesForJobs(
  db: Db,
  jobs: (typeof schema.jobs.$inferSelect)[],
  asOfDate: Date = new Date(),
): Promise<
  {
    job: typeof schema.jobs.$inferSelect;
    baseSalary: number;
    effectiveIncome: number;
    /** This job's bonus override for asOfDate's calendar year, if any —
     *  exposed so callers that also need getTotalCompensation don't have to
     *  re-fetch it themselves. */
    resolvedBonusOverride: number | null;
  }[]
> {
  const bonusOverrides = await getBonusOverridesForJobs(
    db,
    jobs.map((j) => j.id),
  );
  const year = asOfDate.getFullYear();
  return Promise.all(
    jobs.map(async (job) => {
      const baseSalary = await getCurrentSalary(
        db,
        job.id,
        job.annualSalary,
        asOfDate,
      );
      const resolvedBonusOverride =
        bonusOverrides.get(`${job.id}:${year}`) ?? null;
      const effectiveIncome = getEffectiveIncome(
        job,
        baseSalary,
        resolvedBonusOverride,
      );
      return { job, baseSalary, effectiveIncome, resolvedBonusOverride };
    }),
  );
}

/**
 * Fetch every bonus override row for the given jobs, across all years,
 * keyed `"${jobId}:${year}"`. Batched (one query) rather than per-job so
 * callers that need multiple years for the same job set (e.g. historical.ts's
 * per-year reconstruction loop) don't re-query per year.
 */
export async function getBonusOverridesForJobs(
  db: Db,
  jobIds: number[],
): Promise<Map<string, number>> {
  if (jobIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(schema.jobBonusOverrides)
    .where(inArray(schema.jobBonusOverrides.jobId, jobIds));
  return new Map(
    rows.map((r) => [`${r.jobId}:${r.year}`, toNumber(r.overrideAmount)]),
  );
}

/**
 * Compute effective income for a job — salary + annual bonus when
 * includeBonusInContributions is true. Used for payroll contribution calculations
 * where the flag controls whether percent-of-salary deductions apply to bonus pay.
 *
 * `resolvedBonusOverride` must be resolved by the caller for the specific
 * year in question (via getBonusOverridesForJobs) — there is no shared
 * fallback the way the old flat jobs.bonus_override column had, so passing
 * the wrong year's value (or always-current when a past/future year is
 * intended) silently produces the wrong number.
 */
export function getEffectiveIncome(
  job: typeof schema.jobs.$inferSelect,
  baseSalary: number,
  resolvedBonusOverride: number | null,
): number {
  if (!job.includeBonusInContributions) return baseSalary;
  return getTotalCompensation(job, baseSalary, resolvedBonusOverride);
}

/**
 * Compute total compensation (salary + bonus) regardless of the
 * includeBonusInContributions flag. Used for display and projection
 * purposes where total comp is always the relevant number.
 *
 * See getEffectiveIncome's docblock for the `resolvedBonusOverride` contract.
 */
export function getTotalCompensation(
  job: typeof schema.jobs.$inferSelect,
  baseSalary: number,
  resolvedBonusOverride: number | null,
): number {
  const bonus = computeBonusGross(
    baseSalary,
    job.bonusPercent,
    job.bonusMultiplier,
    resolvedBonusOverride,
    job.monthsInBonusYear,
  );
  return baseSalary + bonus;
}

/**
 * Compute gross bonus amount from job fields.
 * Formula: salary × bonusPercent × bonusMultiplier × (monthsInBonusYear / 12).
 * If bonusOverride is set (including explicitly to 0), returns that directly.
 */
export function computeBonusGross(
  salary: number,
  bonusPercent: string | null,
  bonusMultiplier: string | null,
  bonusOverride: number | null,
  monthsInBonusYear: number | null,
): number {
  if (bonusOverride !== null) return roundToCents(bonusOverride);
  const pct = toNumber(bonusPercent);
  if (pct <= 0) return 0;
  const mult = toNumber(bonusMultiplier) || 1;
  const months = monthsInBonusYear ?? 12;
  return roundToCents(salary * pct * mult * (months / 12));
}

/**
 * Get the next upcoming salary change for a job (effective date > asOfDate).
 * Returns null if no future change is scheduled.
 */
export async function getFutureSalaryChanges(
  db: Db,
  jobId: number,
  asOfDate: Date = new Date(),
): Promise<{ salary: number; effectiveDate: string }[]> {
  const changes = await db
    .select()
    .from(schema.salaryChanges)
    .where(
      and(
        eq(schema.salaryChanges.jobId, jobId),
        gt(
          schema.salaryChanges.effectiveDate,
          asOfDate.toISOString().slice(0, 10),
        ),
      ),
    )
    .orderBy(asc(schema.salaryChanges.effectiveDate));

  return changes.map((c: { newSalary: string; effectiveDate: string }) => ({
    salary: toNumber(c.newSalary),
    effectiveDate: c.effectiveDate,
  }));
}

/**
 * Get the full salary timeline for a job within a given year.
 * Returns entries in date order, starting with the rate effective on Jan 1
 * (from most recent change before the year, or job base salary as fallback),
 * followed by all changes within the year (past + future).
 */
export async function getSalaryTimelineForYear(
  db: Db,
  jobId: number,
  fallbackSalary: string,
  year: number,
): Promise<{ salary: number; effectiveDate: string | null }[]> {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  // Starting salary: most recent change before Jan 1 of the target year
  const startingSalary = await getCurrentSalary(
    db,
    jobId,
    fallbackSalary,
    new Date(`${year}-01-01T00:00:00`),
  );

  // All changes within the target year (both past and future)
  const changesInYear = await db
    .select()
    .from(schema.salaryChanges)
    .where(
      and(
        eq(schema.salaryChanges.jobId, jobId),
        gte(schema.salaryChanges.effectiveDate, yearStart),
        lte(schema.salaryChanges.effectiveDate, yearEnd),
      ),
    )
    .orderBy(asc(schema.salaryChanges.effectiveDate));

  const timeline: { salary: number; effectiveDate: string | null }[] = [
    { salary: startingSalary, effectiveDate: null },
  ];

  for (const c of changesInYear) {
    timeline.push({
      salary: toNumber(c.newSalary),
      effectiveDate: c.effectiveDate,
    });
  }

  return timeline;
}
