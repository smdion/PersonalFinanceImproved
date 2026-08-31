/**
 * Budget expense computation helpers.
 */
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { roundToCents } from "@/lib/utils/math";
import { toNumber } from "./transforms";
import type { Db } from "./transforms";
import { parseAppSettings } from "./settings";
import {
  filterActiveJobs,
  type ContribResolutionStatus,
} from "@/lib/pure/profiles";
import {
  loadEffectiveSalaryProfile,
  resolveCompensation,
  applyActiveSalary,
  applyActiveBonusTerms,
  getEffectiveIncome,
  applySandboxSalaryEntries,
} from "./salary";
import type { SalaryActiveMap, SalaryOverrideEntry } from "./salary";
import {
  loadAndApplyContribProfile,
  applyContribActiveFields,
  computeAnnualContribution,
  resolveJoblessPeriodsPerYear,
  resolveContribPeriods,
  classifyContribResolution,
} from "./contribution";

/** No TTL — cached YNAB data is kept until the user manually triggers a resync. */
export const BUDGET_CACHE_MAX_AGE_MS = undefined;

/**
 * The active-profile predicate, for callers that already have every profile
 * loaded in memory (e.g. the retirement engine payload builder, which fetches
 * `allBudgetProfiles` once for several purposes) and would otherwise
 * duplicate `getActiveBudgetProfile`'s `isActive` lookup inline.
 */
export function pickActiveBudgetProfile<T extends { isActive: boolean }>(
  profiles: T[],
): T | undefined {
  return profiles.find((p) => p.isActive);
}

/**
 * The active budget profile — the only place that should query
 * `budget_profiles.is_active = true`. Returns undefined if none is active
 * (e.g. a crash mid-`setActiveProfile` before that mutation's transaction
 * fix, or before any profile has ever been created).
 */
export async function getActiveBudgetProfile(
  db: Db,
): Promise<typeof schema.budgetProfiles.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(schema.budgetProfiles)
    .where(eq(schema.budgetProfiles.isActive, true));
  return pickActiveBudgetProfile(rows);
}

/**
 * Resolve "the profile a mutation should target" — explicit `profileId` when
 * given (a client editing a Plan-pinned or manually-viewed non-active
 * profile), else the globally-active profile. The single place profile
 * item/column mutations (createItem, addColumn, removeColumn, renameColumn,
 * updateColumnMonths, updateColumnContributionProfileIds, reorderCategory)
 * should resolve their target profile — a bare `getActiveBudgetProfile(db)`
 * in one of those procedures silently redirects an edit made while viewing a
 * non-active profile onto the active one instead.
 */
export async function resolveTargetBudgetProfile(
  db: Db,
  profileId: number | null | undefined,
): Promise<typeof schema.budgetProfiles.$inferSelect | undefined> {
  if (profileId) {
    const rows = await db
      .select()
      .from(schema.budgetProfiles)
      .where(eq(schema.budgetProfiles.id, profileId));
    return rows[0];
  }
  return getActiveBudgetProfile(db);
}

/**
 * Sum the CACHED balances of every account manually mapped to a fixed
 * pseudo-account (`localId` "cash" or "creditCard") for the given service —
 * see AccountMapping's docblock (schema-pg.ts). Returns `null` when the
 * service has no such mappings at all, so callers can fall back to their
 * own auto-detection instead of reporting a real $0.
 *
 * Manual mapping exists because Actual's API has no account "type" field
 * at all (verified live, 2026-08-31 — the plain `/accounts` endpoint
 * returns only id/name/offbudget/closed, and a raw query against the
 * underlying `accounts` table itself has no `type` column either), so
 * there's no way to auto-detect "this is a checking account" the way
 * YNAB's account type lets `getEffectiveCash` do below. `Math.abs` on each
 * matched balance — a credit card mapping's balance is typically negative
 * (money owed); this returns its magnitude as a debt figure, matching how
 * apply-pull-mapping.ts already treats a mapped mortgage loan balance.
 */
async function sumMappedAccountBalances(
  db: Db,
  service: "ynab" | "actual",
  localId: "cash" | "creditCard",
): Promise<number | null> {
  const { cacheGet } = await import("@/lib/budget-api");
  const [conn] = await db
    .select({ accountMappings: schema.apiConnections.accountMappings })
    .from(schema.apiConnections)
    .where(eq(schema.apiConnections.service, service));
  const mapped = (conn?.accountMappings ?? []).filter(
    (m) =>
      m.localId === localId &&
      (m.syncDirection === "pull" || m.syncDirection === "both"),
  );
  if (mapped.length === 0) return null;

  type BudgetAccount = { id: string; balance: number };
  const cached = await cacheGet<BudgetAccount[]>(
    db,
    service,
    "accounts",
    BUDGET_CACHE_MAX_AGE_MS,
  );
  if (!cached) return null;
  const byId = new Map(cached.data.map((a) => [a.id, a.balance]));
  return mapped.reduce(
    (sum, m) => sum + Math.abs(byId.get(m.remoteAccountId) ?? 0),
    0,
  );
}

/**
 * Get effective cash balance.
 * When the active service has explicit "Cash" account mappings (see
 * sumMappedAccountBalances), sums those. Otherwise, for a budget API with a
 * real account-type field (YNAB), falls back to auto-detecting on-budget
 * checking/savings/cash accounts from cache. Falls back further to manual
 * `current_cash` from app_settings when no API is active, the cache is
 * stale/empty, or auto-detection finds nothing (e.g. Actual, which has no
 * account-type field to auto-detect from at all).
 */
export async function getEffectiveCash(
  db: Db,
  settings: { key: string; value: unknown }[],
): Promise<{
  cash: number;
  source: "ynab" | "actual" | "manual";
  cacheAgeDays: number | null;
}> {
  const { getActiveBudgetApi, cacheGet } = await import("@/lib/budget-api");
  const active = await getActiveBudgetApi(db);

  if (active !== "none") {
    const mappedCash = await sumMappedAccountBalances(db, active, "cash");
    if (mappedCash !== null) {
      return { cash: mappedCash, source: active, cacheAgeDays: 0 };
    }

    type BudgetAccount = {
      onBudget: boolean;
      closed: boolean;
      type: string;
      balance: number;
    };
    const cached = await cacheGet<BudgetAccount[]>(
      db,
      active,
      "accounts",
      BUDGET_CACHE_MAX_AGE_MS,
    );
    if (cached) {
      const cashTypes = new Set(["checking", "savings", "cash"]);
      const cash = cached.data
        .filter((a) => a.onBudget && !a.closed && cashTypes.has(a.type))
        .reduce((sum, a) => sum + a.balance, 0);
      const cacheAgeDays = Math.floor(
        (Date.now() - cached.fetchedAt.getTime()) / 86_400_000,
      );
      return { cash, source: active, cacheAgeDays };
    }
  }

  // Fallback to manual cash
  const setting = parseAppSettings(settings);
  return {
    cash: setting("current_cash", 0),
    source: "manual",
    cacheAgeDays: null,
  };
}

/**
 * Effective credit-card debt from explicit "Credit Card" account mappings
 * (see sumMappedAccountBalances) — additive on top of the household's
 * manual `current_other_liabilities` figure, not a replacement for it,
 * since that setting may legitimately hold other debts too. Unlike
 * getEffectiveCash there's no auto-detection fallback for either service:
 * neither YNAB nor Actual's account list distinguishes a credit card from
 * any other on-budget account well enough to guess safely, so this only
 * ever returns a nonzero figure once the household has mapped at least one
 * account.
 */
export async function getEffectiveCreditCardDebt(db: Db): Promise<number> {
  const { getActiveBudgetApi } = await import("@/lib/budget-api");
  const active = await getActiveBudgetApi(db);
  if (active === "none") return 0;
  return (await sumMappedAccountBalances(db, active, "creditCard")) ?? 0;
}

/**
 * Effective other-assets total for current year.
 * When otherAssetItems exist (carry-forward to current year), uses their total;
 * otherwise falls back to app_settings['current_other_assets'].
 * This ensures API-synced asset values (which write to otherAssetItems) flow
 * into net worth, historical, and finalize-year calculations.
 */
export async function getEffectiveOtherAssets(
  db: Db,
  settings: { key: string; value: unknown }[],
  asOfDate: Date = new Date(),
): Promise<number> {
  const result = await getEffectiveOtherAssetsDetailed(db, settings, asOfDate);
  return result.total;
}

/** Returns individual other-asset items (carry-forward) plus total.
 *  Each item includes `sourceYear` — the year the value was last entered.
 *  When sourceYear < currentYear, the value is carried forward and may be stale.
 *  `id` is included so callers can check API sync mappings.
 *  `asOfDate` defaults to now; pass it explicitly when the caller already has
 *  a resolved date (e.g. a year-end snapshot) to avoid a fresh `new Date()`. */
export async function getEffectiveOtherAssetsDetailed(
  db: Db,
  settings: { key: string; value: unknown }[],
  asOfDate: Date = new Date(),
): Promise<{
  items: {
    id: number | null;
    name: string;
    value: number;
    sourceYear: number;
  }[];
  total: number;
}> {
  const currentYear = asOfDate.getFullYear();
  const allItems = await db.select().from(schema.otherAssetItems);

  // Carry-forward: for each unique name, find the latest entry where year <= currentYear
  const uniqueNames = Array.from(new Set(allItems.map((a) => a.name)));
  const items: {
    id: number | null;
    name: string;
    value: number;
    sourceYear: number;
  }[] = [];
  for (const name of uniqueNames) {
    const entries = allItems
      .filter((a) => a.name === name && a.year <= currentYear)
      .sort((a, b) => a.year - b.year);
    if (entries.length > 0) {
      const latest = entries[entries.length - 1]!;
      const val = toNumber(latest.value);
      if (val > 0) {
        items.push({
          id: latest.id,
          name,
          value: val,
          sourceYear: latest.year,
        });
      }
    }
  }

  if (items.length > 0) {
    return { items, total: items.reduce((s, i) => s + i.value, 0) };
  }

  // Fallback to manual scalar
  const setting = parseAppSettings(settings);
  const fallback = setting("current_other_assets", 0);
  return {
    items:
      fallback > 0
        ? [
            {
              id: null,
              name: "Other Assets",
              value: fallback,
              sourceYear: currentYear,
            },
          ]
        : [],
    total: fallback,
  };
}

/**
 * Compute annualized total for a specific budget column from an array of
 * budget items. Each item's `amounts` array holds monthly values per column.
 * Used for tier-mode profiles (pick one column, × 12).
 */
export function computeBudgetColumnTotal(
  items: { amounts: number[] }[],
  columnIndex: number,
): number {
  const monthlyTotal = items.reduce(
    (sum, item) => sum + (item.amounts[columnIndex] ?? 0),
    0,
  );
  return roundToCents(monthlyTotal * 12);
}

/**
 * Compute annualized total for a weighted-months profile.
 * Each column's monthly total is multiplied by its month weight.
 * Annual = sum(column_monthly_total × column_months[col])
 */
export function computeWeightedBudgetTotal(
  items: { amounts: number[] }[],
  columnMonths: number[],
): number {
  let annual = 0;
  for (let col = 0; col < columnMonths.length; col++) {
    const monthlyTotal = items.reduce(
      (sum, item) => sum + (item.amounts[col] ?? 0),
      0,
    );
    annual += monthlyTotal * (columnMonths[col] ?? 0);
  }
  return roundToCents(annual);
}

/**
 * Compute the correct annual total for a profile, handling both modes:
 * - Weighted profiles (columnMonths set): weighted combination of all columns
 * - Tier profiles (columnMonths null): single column × 12
 */
export function computeBudgetAnnualTotal(
  items: { amounts: number[] }[],
  columnIndex: number,
  columnMonths: number[] | null,
): number {
  if (columnMonths) return computeWeightedBudgetTotal(items, columnMonths);
  return computeBudgetColumnTotal(items, columnIndex);
}

/**
 * Resolve every linked budget item's per-column dollar amounts through the
 * SAME contribution-account resolution `budget.computeActiveSummary` uses,
 * instead of the item's raw `amounts` column (which is intentionally left
 * stale for linked items — see budget.ts router's `updateItemAmount`/
 * `updateItemAmounts`). Any caller that sums `budget_items.amounts` directly
 * for a profile with contribution-linked items (retirement/projection engine
 * inputs, net-worth year-end snapshots) silently undercounts every linked
 * item, since its raw amount is never written past its `0` template value.
 *
 * `contribProfileIdByColumn`/`salaryProfileIdByColumn` must already reflect
 * the caller's own Plan-pin/column-pin resolution for each column — this
 * function does no tier resolution of its own, so a linked item's dollar
 * figure can never disagree between the Budget tab and any other consumer.
 *
 * `opts.sandboxContribActiveFields`/`sandboxSalaryEntries` are the What-If
 * sandbox's own hand-edited values — the highest-precedence tier, layered
 * on top of `planSalaryActiveMap`/the Contribution Profile's resolved
 * values exactly the way `budget.computeActiveSummary` needs them to be
 * for its own linked items, so that endpoint can call this helper directly
 * instead of maintaining its own copy of this resolution.
 */
export async function resolveLinkedBudgetItemAmounts<
  T extends {
    id: number;
    contributionAccountId: number | null;
    amounts: unknown;
  },
>(
  db: Db,
  items: T[],
  numColumns: number,
  contribProfileIdByColumn: (number | null)[],
  salaryProfileIdByColumn: (number | null)[],
  opts?: {
    planSalaryActiveMap?: SalaryActiveMap;
    sandboxContribActiveFields?: Record<string, { contributionValue: string }>;
    sandboxSalaryEntries?: Record<string, SalaryOverrideEntry> | null;
  },
): Promise<
  (T & { amounts: number[]; contribStatus: ContribResolutionStatus[] | null })[]
> {
  const linkedContribIds = new Set(
    items
      .filter((i) => i.contributionAccountId != null)
      .map((i) => i.contributionAccountId!),
  );
  if (linkedContribIds.size === 0) {
    return items.map((i) => ({
      ...i,
      amounts: i.amounts as number[],
      contribStatus: null,
    }));
  }

  const rawContribs = await db
    .select()
    .from(schema.contributionAccounts)
    .where(eq(schema.contributionAccounts.isActive, true));
  const rawContribIds = new Set(rawContribs.map((c) => c.id));
  const allJobs = await db.select().from(schema.jobs);
  const effectiveSalaryMap: SalaryActiveMap = applySandboxSalaryEntries(
    opts?.sandboxSalaryEntries,
    opts?.planSalaryActiveMap ?? new Map(),
  );

  const computeContribMonthlyForPair = async (
    contribProfileId: number | null,
    salaryProfileId: number | null,
  ): Promise<{
    contribMonthlyById: Map<number, number>;
    statusById: Map<number, ContribResolutionStatus>;
  }> => {
    const contribMonthlyById = new Map<number, number>();
    const incompleteIds = new Set<number>();
    const salaryProfileActiveMap = await loadEffectiveSalaryProfile(
      db,
      salaryProfileId,
    );
    const profileResult = await loadAndApplyContribProfile(
      db,
      contribProfileId,
      rawContribs,
      allJobs,
      salaryProfileActiveMap,
    );
    const activeContribs = applyContribActiveFields(
      profileResult.contribs,
      opts?.sandboxContribActiveFields ?? {},
      true,
    );
    const activeContribIds = new Set(activeContribs.map((c) => c.id));
    const activeJobs = filterActiveJobs(profileResult.jobs);
    const {
      periodsPerYear: defaultPeriodsPerYear,
      incomplete: joblessIncomplete,
    } = resolveJoblessPeriodsPerYear(activeJobs);

    const salaryByJobId = new Map<number, number>();
    for (const j of activeJobs) {
      const comp = resolveCompensation(salaryProfileActiveMap, j.id);
      const sandboxEntry = effectiveSalaryMap.get(j.personId);
      const salary = applyActiveSalary(
        j.personId,
        comp.salary,
        effectiveSalaryMap,
      );
      const bonusTerms = applyActiveBonusTerms(sandboxEntry, comp.terms);
      salaryByJobId.set(j.id, getEffectiveIncome(j, salary, bonusTerms));
    }

    for (const c of activeContribs) {
      if (!linkedContribIds.has(c.id)) continue;
      const val = Number(c.contributionValue);
      const isFixedPerPeriod = c.contributionMethod === "fixed_per_period";
      let jobPeriodsPerYear: number;
      let incomplete: boolean;
      if (c.jobId) {
        const job = activeJobs.find((j) => j.id === c.jobId);
        const resolved = resolveContribPeriods(c.contributionMethod, job);
        jobPeriodsPerYear = resolved.periodsPerYear;
        incomplete = resolved.incomplete;
      } else {
        jobPeriodsPerYear = defaultPeriodsPerYear;
        incomplete = isFixedPerPeriod && joblessIncomplete;
      }
      if (incomplete) {
        incompleteIds.add(c.id);
        contribMonthlyById.set(c.id, 0);
        continue;
      }
      const salary = c.jobId ? (salaryByJobId.get(c.jobId) ?? 0) : 0;
      const annual = computeAnnualContribution(
        c.contributionMethod,
        val,
        salary,
        jobPeriodsPerYear,
      );
      contribMonthlyById.set(c.id, annual / 12);
    }

    const statusById = new Map<number, ContribResolutionStatus>();
    for (const accountId of linkedContribIds) {
      statusById.set(
        accountId,
        classifyContribResolution(
          accountId,
          rawContribIds,
          profileResult.contribActiveFields,
          activeContribIds,
          incompleteIds,
        ),
      );
    }
    return { contribMonthlyById, statusById };
  };

  const contribMonthlyByPair = new Map<
    string,
    {
      contribMonthlyById: Map<number, number>;
      statusById: Map<number, ContribResolutionStatus>;
    }
  >();
  const contribMonthlyByColumn: Map<number, number>[] = [];
  const statusByColumn: Map<number, ContribResolutionStatus>[] = [];
  for (let col = 0; col < numColumns; col++) {
    const contribProfileId = contribProfileIdByColumn[col] ?? null;
    const salaryProfileId = salaryProfileIdByColumn[col] ?? null;
    const key = `${contribProfileId}:${salaryProfileId}`;
    let resolved = contribMonthlyByPair.get(key);
    if (!resolved) {
      resolved = await computeContribMonthlyForPair(
        contribProfileId,
        salaryProfileId,
      );
      contribMonthlyByPair.set(key, resolved);
    }
    contribMonthlyByColumn.push(resolved.contribMonthlyById);
    statusByColumn.push(resolved.statusById);
  }

  return items.map((i) => {
    if (i.contributionAccountId == null) {
      return { ...i, amounts: i.amounts as number[], contribStatus: null };
    }
    const accountId = i.contributionAccountId;
    const amounts = Array.from(
      { length: numColumns },
      (_, col) => contribMonthlyByColumn[col]?.get(accountId) ?? 0,
    );
    const contribStatus = Array.from(
      { length: numColumns },
      (_, col) => statusByColumn[col]?.get(accountId) ?? "ok",
    );
    return { ...i, amounts, contribStatus };
  });
}

/**
 * Optional override of which budget profile/column to read — lets a caller ask
 * "what would annual expenses be under profile X, column Y" instead of always
 * reading the globally-active profile + `budget_active_column` setting.
 */
export type BudgetTargeting = {
  budgetProfileId?: number | null;
  budgetColumn?: number | null;
};

export async function getAnnualExpensesFromBudget(
  db: Db,
  targeting?: BudgetTargeting,
): Promise<number> {
  const settings = await db.select().from(schema.appSettings);
  const settingsMap = new Map(
    settings.map((s: { key: string; value: unknown }) => [s.key, s.value]),
  );

  // Use the shared budget_active_column setting (same as budget page, savings page, dashboard)
  const columnSetting = settingsMap.get("budget_active_column");
  const column =
    targeting?.budgetColumn ??
    (typeof columnSetting === "number" ? columnSetting : 0);

  const profile = await resolveTargetBudgetProfile(
    db,
    targeting?.budgetProfileId,
  );

  if (!profile) return 0;

  const items = await db
    .select()
    .from(schema.budgetItems)
    .where(eq(schema.budgetItems.profileId, profile.id));

  const columnLabels = profile.columnLabels as string[];
  const numColumns = columnLabels.length;
  const resolvedItems = await resolveLinkedBudgetItemAmounts(
    db,
    items,
    numColumns,
    new Array(numColumns).fill(null),
    new Array(numColumns).fill(null),
  );

  return computeBudgetAnnualTotal(
    resolvedItems,
    column,
    profile.columnMonths as number[] | null,
  );
}
