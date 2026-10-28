/**
 * Holdings valued today and the Benchmarks overview built on them. Loaders
 * for the investments routers (Benchmarks, Portfolio account insights).
 */
import { sumBy } from "@/lib/utils/math";
import { accountFeesForYears } from "@/lib/pure/performance";
import { eq, inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import {
  COMPOSITION_BUCKET_VALUES,
  MAJOR_COMPOSITION_BUCKETS,
} from "@/lib/config/enum-values";
import {
  accountRollup,
  blendedCost,
  effectiveFacts,
  portfolioBuckets,
  valueByClass,
} from "@/lib/pure/fund-facts";
import { interpolateAllocations } from "@/lib/calculators/random";
import { blendedReturnForAge } from "@/lib/pure/projection";
import { getAge, localDateStr } from "@/lib/utils/date";
import { getLatestMarketClose } from "@/server/helpers/market-prices";
import { getSecConnection } from "@/lib/sec/connection";
import { loadBucketLinks, toFactRows } from "@/server/helpers/fund-facts";
import { loadAccounts, loadLatestHoldings } from "./_shared";
import { SK_CURRENT_GLIDE_PATH } from "@/lib/constants/settings-keys";
import {
  parseCurrentGlidePath,
  unknownAssetClassIds,
} from "@/lib/pure/current-glide-path";

type Db = typeof import("@/lib/db").db;

/**
 * Target allocation by asset class for the primary person's age: the
 * household's current glide path when it has set one, otherwise the
 * retirement simulation's glide path (the engine's own interpolation).
 */
async function targetByAssetClass(db: Db): Promise<{
  age: number | null;
  target: Record<number, number>;
  source: "current" | "retirement";
  /** The glide path the target comes from (for charting). */
  glidePath: { age: number; allocations: Record<number, number> }[];
  currentGlidePath:
    { age: number; allocations: Record<number, number> }[] | null;
  /** The saved current glide path names an asset class that no longer
   *  exists, so the target falls back to the retirement glide path. */
  currentGlidePathStale: boolean;
}> {
  const [[person], rows, [currentRow], activeClasses] = await Promise.all([
    db
      .select({ dob: schema.people.dateOfBirth })
      .from(schema.people)
      .where(eq(schema.people.isPrimaryUser, true))
      .limit(1),
    db.select().from(schema.glidePathAllocations),
    db
      .select({ value: schema.appSettings.value })
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, SK_CURRENT_GLIDE_PATH))
      .limit(1),
    db
      .select({ id: schema.assetClassParams.id })
      .from(schema.assetClassParams)
      .where(eq(schema.assetClassParams.isActive, true)),
  ]);
  const currentGlidePath = parseCurrentGlidePath(currentRow?.value ?? null);
  const currentGlidePathStale =
    currentGlidePath !== null &&
    unknownAssetClassIds(
      currentGlidePath,
      new Set(activeClasses.map((c) => c.id)),
    ).length > 0;
  const usable = currentGlidePathStale ? null : currentGlidePath;
  const source = usable ? "current" : "retirement";
  const byAge = new Map<number, Record<number, number>>();
  for (const r of rows) {
    const a = byAge.get(r.age) ?? {};
    a[r.assetClassId] = Number(r.allocation);
    byAge.set(r.age, a);
  }
  const retirementPath = [...byAge.entries()]
    .sort(([a], [b]) => a - b)
    .map(([gpAge, allocations]) => ({ age: gpAge, allocations }));
  const glidePath = usable ?? retirementPath;
  if (!person)
    return {
      age: null,
      target: {},
      source,
      glidePath,
      currentGlidePath,
      currentGlidePathStale,
    };
  const age = getAge(new Date(`${person.dob}T00:00:00`), new Date());
  return {
    age,
    target: interpolateAllocations(glidePath, age),
    source,
    glidePath,
    currentGlidePath,
    currentGlidePathStale,
  };
}

/**
 * Latest holdings valued today (shares × latest close when the ticker is
 * priced, else the institution's reported value) with each fund's facts.
 * Shared by Benchmarks and the Portfolio page so both value alike.
 */
export async function valueHoldings(
  db: Db,
  holdings: Awaited<ReturnType<typeof loadLatestHoldings>>,
) {
  const securityIds = [...new Set(holdings.map((h) => h.securityId))];
  const [securities, facts] = securityIds.length
    ? await Promise.all([
        db
          .select()
          .from(schema.securities)
          .where(inArray(schema.securities.id, securityIds)),
        db
          .select()
          .from(schema.securityFacts)
          .where(inArray(schema.securityFacts.securityId, securityIds)),
      ])
    : [[], []];
  const today = localDateStr();
  const securityById = new Map(securities.map((s) => [s.id, s]));
  const factsBySecurity = new Map(
    securityIds.map((id) => [
      id,
      effectiveFacts(
        toFactRows(facts.filter((f) => f.securityId === id)),
        today,
      ),
    ]),
  );
  const closes = new Map(
    await Promise.all(
      [
        ...new Set(
          holdings.map((h) => h.ticker).filter((t): t is string => !!t),
        ),
      ].map(async (t) => [t, await getLatestMarketClose(db, t)] as const),
    ),
  );

  const valued = holdings.map((h) => {
    const close = h.ticker ? closes.get(h.ticker) : null;
    const security = securityById.get(h.securityId);
    const value = close ? h.shares * close.close : (h.reportedMarketValue ?? 0);
    return {
      ...h,
      value,
      valueBasis: close ? ("priced" as const) : ("reported" as const),
      valuedOn: close ? close.date : h.asOf,
      facts: factsBySecurity.get(h.securityId)!,
      factsBasis: security?.factsBasis ?? null,
      factsSeriesName: security?.factsSeriesName ?? null,
      standInPending:
        security?.factsBasis === "standin" && !security.standinConfirmedAt,
      /** What the suggested stand-in's filings say (null until checked). */
      standInPreview:
        security?.factsBasis === "standin" && !security.standinConfirmedAt
          ? (security.standinPreview ?? null)
          : null,
    };
  });

  return valued;
}

/**
 * Money in the account that isn't in any reported position (an HSA's cash
 * balance, a brokerage's settlement cash): the feed's balance less the
 * positions as the institution valued them, only when both are from the
 * same day (otherwise price moves would read as cash). null = can't tell.
 */
function uninvestedCash(
  account: { balance: number | null; balanceDay: string | null } | undefined,
  rows: readonly {
    asOf: string;
    value: number;
    reportedMarketValue: number | null;
  }[],
): number | null {
  if (!account || account.balance === null || rows.length === 0) return null;
  if (rows.some((r) => r.asOf !== account.balanceDay)) return null;
  const reported = sumBy(rows, (r) => r.reportedMarketValue ?? r.value);
  return Math.max(0, account.balance - reported);
}

/** Holdings valued today, with each fund's facts; allocation vs target; blended cost. */
export async function loadHoldingsOverview(db: Db) {
  const year = Number(localDateStr().slice(0, 4));
  const [holdings, accounts, sec, assetClasses, target] = await Promise.all([
    loadLatestHoldings(db),
    loadAccounts(db),
    getSecConnection(db),
    db
      .select({
        id: schema.assetClassParams.id,
        name: schema.assetClassParams.name,
        meanReturn: schema.assetClassParams.meanReturn,
        stdDev: schema.assetClassParams.stdDev,
      })
      .from(schema.assetClassParams)
      .where(eq(schema.assetClassParams.isActive, true))
      .orderBy(schema.assetClassParams.sortOrder),
    targetByAssetClass(db),
  ]);
  const [allValued, links] = await Promise.all([
    valueHoldings(db, holdings),
    loadBucketLinks(db),
  ]);
  // Only SimpleFIN accounts linked to a Ledgr account count — an unlinked
  // feed (a duplicate connection, an old replay, an account Ledgr doesn't
  // track) would otherwise count the same money twice. Their dollars are
  // reported so the page can say what's left out.
  const isLinked = (simplefinAccountId: number) =>
    accounts.get(simplefinAccountId)?.performanceAccountId != null;
  const valued = allValued.filter((v) => isLinked(v.simplefinAccountId));
  const unlinkedTotals = new Map<number, number>();
  for (const v of allValued)
    if (!isLinked(v.simplefinAccountId))
      unlinkedTotals.set(
        v.simplefinAccountId,
        (unlinkedTotals.get(v.simplefinAccountId) ?? 0) + v.value,
      );

  const { buckets, unknown, total } = portfolioBuckets(valued);
  const { byClass, unlinked } = valueByClass(buckets, links);
  // The mix's expected return (each class's compounding rate, weighted by
  // the money in it) — what the compounded fund cost grows at.
  const classTotal = sumBy([...byClass.values()], (v) => v);
  const expectedReturn =
    classTotal > 0
      ? blendedReturnForAge(
          assetClasses.map((a) => ({
            id: a.id,
            meanReturn: Number(a.meanReturn),
            stdDev: Number(a.stdDev),
          })),
          Object.fromEntries(
            [...byClass.entries()].map(([id, v]) => [id, v / classTotal]),
          ),
        )
      : null;
  const byAccount = new Map<number, typeof valued>();
  for (const v of valued)
    byAccount.set(v.simplefinAccountId, [
      ...(byAccount.get(v.simplefinAccountId) ?? []),
      v,
    ]);

  return {
    secConnected: sec !== null,
    age: target.age,
    /** Where the targets come from: the household's current glide path, or
     *  (unset) the retirement simulation's. */
    targetSource: target.source,
    glidePath: target.glidePath,
    currentGlidePath: target.currentGlidePath,
    currentGlidePathStale: target.currentGlidePathStale,
    /** SimpleFIN accounts with holdings that aren't linked to a Ledgr
     *  account — left out of everything below. */
    unlinkedAccounts: [...unlinkedTotals.entries()]
      .map(([id, total]) => ({
        simplefinAccountId: id,
        label: accounts.get(id)?.label ?? "",
        total,
      }))
      .filter((a) => a.total > 0)
      .sort((x, y) => y.total - x.total),
    accounts: [...byAccount.entries()]
      .map(([id, rows]) => {
        const a = accounts.get(id);
        return {
          simplefinAccountId: id,
          performanceAccountId: a?.performanceAccountId ?? null,
          label: a?.label ?? "",
          accountType: a?.accountType ?? null,
          /** From a sub-account link; null for a whole-account link. */
          taxType: a?.taxType ?? null,
          ownerPersonId: a?.ownerPersonId ?? a?.accountOwnerPersonId ?? null,
          total: rows.reduce((s, r) => s + r.value, 0),
          uninvestedCash: uninvestedCash(a, rows),
          /** Its funds added up (null for an effectively single-fund account). */
          rollup: accountRollup(rows),
          holdings: rows
            .sort((x, y) => y.value - x.value)
            .map((r) => ({
              securityId: r.securityId,
              // A code SEC didn't confirm (e.g. the institution's own number
              // for a plan-only fund) is shown but never linked to a quote.
              symbol: r.ticker ?? r.sourceSymbol,
              /** SEC confirmed it's a public ticker (safe to link). */
              symbolConfirmed: r.ticker !== null,
              name: r.name,
              shares: r.shares,
              /** The institution's average cost per share (null when not reported). */
              avgCostPerShare: r.avgCostPerShare,
              value: r.value,
              valueBasis: r.valueBasis,
              valuedOn: r.valuedOn,
              facts: r.facts,
              factsBasis: r.factsBasis,
              factsSeriesName: r.factsSeriesName,
              standInPending: r.standInPending,
              standInPreview: r.standInPreview,
            })),
        };
      })
      .sort((x, y) => y.total - x.total),
    allocation: {
      total,
      unknown,
      rows: assetClasses.map((a) => ({
        assetClassId: a.id,
        name: a.name,
        /** The fund categories counted toward it. */
        buckets: COMPOSITION_BUCKET_VALUES.filter((b) => links.get(b) === a.id),
        value: byClass.get(a.id) ?? 0,
        targetPct: target.target[a.id] ?? null,
      })),
      unmapped: unlinked.map((b) => ({ bucket: b, value: buckets[b] })),
      /** Every major fund category, held or not, with the class it counts toward. */
      categories: MAJOR_COMPOSITION_BUCKETS.map((b) => ({
        bucket: b,
        value: buckets[b],
        assetClassId: links.get(b) ?? null,
      })),
    },
    cost: blendedCost(valued),
    /** The current mix's expected yearly return; null when no money's
     *  mix is known. */
    expectedReturn,
    /** Account fees (Performance's Fees column) — the other kind of cost,
     *  shown beside fund costs, never added into them. */
    accountFees: accountFeesForYears(
      await db
        .select({
          year: schema.accountPerformance.year,
          fees: schema.accountPerformance.fees,
        })
        .from(schema.accountPerformance)
        .where(inArray(schema.accountPerformance.year, [year - 1, year])),
      year,
    ),
  };
}
