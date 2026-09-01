/**
 * Server-side cache for retirement projection results — the deterministic
 * engine result, Monte Carlo, and Coast FIRE MC. See schema-pg.ts's
 * `projectionCache` doc comment for why this is its own table rather than
 * reusing `budgetApiCache`.
 *
 * Design:
 *  - Cache key = sha256 of a canonicalized JSON form of the EXACT object
 *    passed to the pure calculator (calculateProjection/calculateMonteCarlo),
 *    not the raw tRPC input — the router resolves contributionProfileId/
 *    salaryProfileId/etc. into live DB state (salaries, portfolio,
 *    contribution accounts, IRS limits) that isn't otherwise captured, and
 *    hashing only the tRPC input would silently serve stale cross-device
 *    results after e.g. a salary edit. Canonicalization sorts object keys
 *    (defense in depth — the source objects already have stable insertion
 *    order) and truncates any Date to day granularity (asOfDate is threaded
 *    through per RULES.md's Time Resolution convention and would otherwise
 *    make every request a miss).
 *  - `seed` lives WITH the cached row, not as a separately-persisted
 *    setting: a cache MISS generates a fresh random seed and stores it
 *    alongside the result; a HIT returns the seed that was already used —
 *    honestly reproducible ("this exact run really would produce this
 *    answer"), not a frozen snapshot of randomness masquerading as
 *    determinism. "Re-run simulation" forces a miss (see forceRefresh
 *    param), which mints a new seed.
 *  - `engineVersion` (PROJECTION_CACHE_ENGINE_VERSION below) is folded into
 *    the uniqueness constraint so bumping it after an engine-logic change
 *    invalidates every existing row without a manual cache-clear.
 *  - Eviction is opportunistic, not cron-driven: every write deletes
 *    expired rows and, if the table is still over the size cap, the
 *    oldest-by-lastReadAt rows — cheap enough to run inline given how
 *    infrequently writes happen relative to reads.
 */

import { createHash } from "crypto";
import { and, eq, lt, asc, sql, inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Db } from "./transforms";
import { log } from "@/lib/logger";

/** Bump when a change to the engine's computation logic could change
 *  output for the same inputs — invalidates all existing cache rows.
 *
 *  11: Retirement Profiles step B — the engine's assumptions now come from
 *  the active profile's rows instead of the primary person's. The VALUES are
 *  unchanged (step A's backfill guarantees it, and the golden-baseline diff
 *  is byte-identical), but the source changed, so rows cached before the
 *  cutover must not be served afterwards — otherwise a household that later
 *  switches profiles keeps seeing the old profile's cached numbers.
 *
 *  12: LTCG bracket lookups (0%/15%/20% room, and the tax actually charged
 *  on brokerage gains) were being fed GROSS ordinary income where the
 *  brackets are denominated in real taxable income — systematically
 *  understating 0%-LTCG room and overcharging real LTCG tax every
 *  decumulation year with a brokerage draw. Fixed via `toLtcgTaxableIncome`
 *  (tax-tables.ts), threaded through `withdrawal-cost-ranking.ts`,
 *  `tax-estimation.ts`, and `decumulation-year.ts`'s Roth-conversion-revised
 *  recompute. A REAL value change (not just a source change like #11) —
 *  cached rows from before this fix would show less LTCG-0% room and a
 *  higher LTCG tax bill than the corrected engine actually computes.
 *
 *  13: R56/R57 — the ordinary W-4/Pub 15-T bracket lookups (bracket-filling
 *  room, ordinary-income effective/marginal rate) were fed GROSS ordinary
 *  income against a table whose own first threshold embeds only the
 *  smaller Worksheet 1A adjustment, not the full standard deduction —
 *  systematically OVERSTATING ordinary-income tax and UNDERSTATING
 *  bracket-filling/Roth-conversion room every decumulation year. Fixed via
 *  `toOrdinaryBracketIncome` (tax-estimation.ts), threaded through
 *  `estimateEffectiveTaxRate`/`incomeCapForMarginalRate`/
 *  `marginalRateAtIncome` and every caller (`withdrawal-routing.ts`,
 *  `withdrawal-cost-ranking.ts`, `post-withdrawal-optimizer.ts`,
 *  `decumulation-year.ts`, `build-engine-payload.ts`'s fallback-rate
 *  estimate). Also fixed the equivalent bug in `calculateTax`'s annual
 *  liability path (`tax.ts`, via `buildLiabilityBracketInput`/
 *  `toTaxableIncomeBrackets`) and `calculatePaycheck`'s per-period
 *  withholding (`paycheck.ts`'s `adjustedAnnualWage`, previously missing
 *  the same adjustment entirely). A REAL value change — cached
 *  decumulation-year rows from before this fix understate bracket-filling
 *  room and overstate ordinary tax cost.
 *
 *  14: `rankWithdrawalTiers`'s brokerage-beyond-the-free-zone pricing
 *  (`withdrawal-cost-ranking.ts`) evaluated the LTCG rate exactly AT the
 *  0%-bracket ceiling, which `getLtcgRate`'s inclusive `<=` semantics
 *  resolve to the LOWER (0%) rate — mispricing that tier as free/NIIT-only
 *  well past its real 15%/20% rate for any household with 0%-LTCG room
 *  left. Ranking disagreed with the real tax charge (`computeLtcgTax`,
 *  unaffected), causing the engine to over-select brokerage over cheaper
 *  Roth growth. Fixed via `ltcgRateForNextDollar` (tax-tables.ts), an
 *  exclusive-boundary lookup. A REAL value change — cached rows from
 *  before this fix understate brokerage's real cost and over-draw it.
 *
 *  15: added `rothBasisCapacity`/`brokerageZeroLtcgCapacity` to
 *  `EngineDecumulationYear` (`withdrawal-cost-ranking.ts`'s
 *  `RankedWithdrawalTiers`, threaded through `decumulation-year.ts`) — an
 *  output-shape ADDITION, not a value change to any existing field (same
 *  precedent as `rateSeededDecumulationYear1`, line ~258 below). Bumped
 *  anyway so the new "why isn't brokerage draining" visibility isn't
 *  hidden behind a stale cached row for up to the 36h TTL — a diagnostic
 *  feature that's invisible to the household that asked for it on ship day
 *  defeats its own purpose.
 *
 *  16: ordinary tax brackets + standard deduction (`bracket-growth.ts`,
 *  `decumulation-year.ts`) now grow forward off `inflationRate` from
 *  their own DB vintage (`distributionTaxRates.taxDataYear`) instead of
 *  being held flat in nominal dollars for the whole projection. A REAL
 *  value change for any decumulation year beyond the tax data's own
 *  year — cached rows from before this fix understate the household's
 *  real bracket-fill room and overstate tax burden in later years
 *  (verified live: a real household's Traditional bracket cap was frozen
 *  at $133,000 across 40 projected years while nominal spending need
 *  more than doubled over the same span).
 *
 *  17: LTCG brackets (`growLtcgBrackets`, `bracket-growth.ts`) now grow
 *  forward the same way ordinary brackets did in v16 — same
 *  `taxGrowthFactor`, same flat-nominal bug, same fix. A REAL value
 *  change: per-year `taxCost`, `discretionaryTierBreakdown`, and
 *  `postConversionLtcgRate` all shift for any household with a
 *  `taxDataYear` and decumulation years beyond it.
 *
 *  18: IRMAA brackets (`growIrmaaBrackets`, `bracket-growth.ts`) now grow
 *  forward off `IRMAA_DATA_YEAR` (irmaa-tables.ts) — a distinct anchor
 *  from `taxDataYear`, not shared with ordinary/LTCG brackets. A REAL
 *  value change for any household with `enableIrmaaAwareness` on:
 *  `irmaaCost` (display + the lifetime-tax objective
 *  `withdrawal-bracket-optimizer.ts` selects a conversion target from)
 *  shifts, and — because `irmaaAwareRothConversions` caps the actual
 *  `rothConversionAmount` against the (previously ungrown) next IRMAA
 *  cliff — this changes real withdrawal amounts, not just a displayed
 *  number, for any household with that toggle on (defaults on whenever
 *  `enableIrmaaAwareness` is).
 *
 *  19: ACA subsidy cliff (400% FPL, `aca-tables.ts`'s `FPL_BY_HOUSEHOLD`)
 *  now grows forward off `FPL_COVERAGE_YEAR` — same flat-nominal bug,
 *  same fix, applied via a `fplGrowthFactor` multiplier at `checkAca`'s
 *  single call site rather than a table-level `grow*` helper (no
 *  `fpl_by_household`-style DB override exists to grow). A REAL value
 *  change for any household with `enableAcaAwareness` on AND everyone
 *  under 65 (`checkAca` early-returns `acaSubsidyPreserved: false` /
 *  `acaMagiHeadroom: 0` otherwise, so a Medicare-age household sees no
 *  movement — this is also why no `engine-snapshot.test.ts` fixture
 *  moved for this phase, unlike Phase 3's two): `acaSubsidyPreserved`/
 *  `acaMagiHeadroom` shift for any decumulation year beyond
 *  `FPL_COVERAGE_YEAR`. Reporting-only (no conversion-cap analog to
 *  IRMAA's `irmaaAwareRothConversions` exists for ACA), but still a
 *  real, user-visible number change, same precedent as v15's bump for
 *  an output-shape addition. */
export const PROJECTION_CACHE_ENGINE_VERSION = 19;

const TTL_MS = 36 * 60 * 60 * 1000; // 36h
const MAX_ROWS = 500;

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) {
    // Day granularity — finer precision doesn't change engine output and
    // would otherwise make every request a miss (asOfDate is resolved
    // fresh, to the millisecond, on every request).
    return value.toISOString().slice(0, 10);
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Hash the exact engine input for one of the cacheable computations. `kind`
 * namespaces the procedures so the same underlying engine input never
 * collides across them — their results are shaped completely differently.
 */
export function hashEngineInput(
  kind:
    | "deterministic"
    | "monteCarlo"
    | "coastFireMc"
    | "coastFireProbe"
    | "strategyComparison",
  input: unknown,
): string {
  const canonical = canonicalize({ kind, input });
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export interface ProjectionCacheHit<TResult> {
  result: TResult;
  seed: number | null;
  computedAt: Date;
}

/** Returns null on a miss (no row, expired, or wrong engine version). */
export async function readProjectionCache<TResult = unknown>(
  db: Db,
  inputHash: string,
): Promise<ProjectionCacheHit<TResult> | null> {
  const [row] = await db
    .select()
    .from(schema.projectionCache)
    .where(
      and(
        eq(schema.projectionCache.inputHash, inputHash),
        eq(
          schema.projectionCache.engineVersion,
          PROJECTION_CACHE_ENGINE_VERSION,
        ),
      ),
    );
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await db
      .delete(schema.projectionCache)
      .where(eq(schema.projectionCache.id, row.id));
    return null;
  }

  // Best-effort freshness touch — an eviction/read-order signal, not load-
  // bearing for correctness, so a failure here must never fail the read.
  db.update(schema.projectionCache)
    .set({ lastReadAt: new Date() })
    .where(eq(schema.projectionCache.id, row.id))
    .catch((err) =>
      log("warn", "projection_cache_touch_failed", { error: String(err) }),
    );

  return {
    result: row.result as TResult,
    seed: row.seed,
    computedAt: row.computedAt,
  };
}

/** Generates a fresh seed, writes the row, and opportunistically evicts.
 *  Returns the seed used (callers that need a seed, e.g. Monte Carlo,
 *  should generate + pass one; deterministic results pass null). */
export async function writeProjectionCache(
  db: Db,
  inputHash: string,
  result: unknown,
  seed: number | null,
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TTL_MS);
  await db
    .insert(schema.projectionCache)
    .values({
      inputHash,
      seed,
      result,
      computedAt: now,
      expiresAt,
      lastReadAt: now,
      engineVersion: PROJECTION_CACHE_ENGINE_VERSION,
    })
    .onConflictDoUpdate({
      target: [
        schema.projectionCache.inputHash,
        schema.projectionCache.engineVersion,
      ],
      set: { seed, result, computedAt: now, expiresAt, lastReadAt: now },
    });

  // Fire-and-forget, same as readProjectionCache's lastReadAt touch below —
  // eviction is opportunistic housekeeping with no bearing on THIS
  // request's own correctness, so it must not add its DB round trips to
  // the response latency of every cache-miss request (exactly the request
  // that already paid for the expensive computation this cache exists to
  // avoid repeating).
  evictProjectionCache(db).catch((err) =>
    log("warn", "projection_cache_evict_failed", { error: String(err) }),
  );
}

/** A fresh, non-cryptographic seed — Monte Carlo doesn't need
 *  cryptographic randomness, just a value that's a real int32 fit for the
 *  engine's PRNG and stable once stored. */
export function generateSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/** Unconditionally wipes every cached deterministic/MC/Coast-FIRE row —
 *  the operational escape hatch for "I need every projection recomputed
 *  right now" without bumping `PROJECTION_CACHE_ENGINE_VERSION` and
 *  redeploying (user request, 2026-08-28: bumping the version has been
 *  the only way to force this all session, which needs a code change +
 *  deploy for what's really a one-off cache-bust). No `user_id`/household
 *  scoping column exists on this table (single-tenant app), so this
 *  clears the whole table by design — the next request per input simply
 *  recomputes and re-populates it. Returns the row count deleted, for a
 *  confirmation toast. */
export async function clearProjectionCache(db: Db): Promise<number> {
  const deleted = await db
    .delete(schema.projectionCache)
    .returning({ id: schema.projectionCache.id });
  return deleted.length;
}

async function evictProjectionCache(db: Db): Promise<void> {
  await db
    .delete(schema.projectionCache)
    .where(lt(schema.projectionCache.expiresAt, new Date()));

  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.projectionCache);
  const over = (countRow?.count ?? 0) - MAX_ROWS;
  if (over <= 0) return;

  const oldest = await db
    .select({ id: schema.projectionCache.id })
    .from(schema.projectionCache)
    .orderBy(asc(schema.projectionCache.lastReadAt))
    .limit(over);
  if (oldest.length === 0) return;
  await db.delete(schema.projectionCache).where(
    inArray(
      schema.projectionCache.id,
      oldest.map((row) => row.id),
    ),
  );
}
