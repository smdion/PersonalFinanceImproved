/**
 * Fund facts on the Benchmarks page: what each holding is worth today, what
 * it holds, what it costs, and the household's own answers where SEC has
 * none (confirm or reject a stand-in, enter facts, link asset classes).
 * portfolioProcedure throughout — holdings, values and allocation.
 */
import { z } from "zod/v4";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, portfolioProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import {
  COMPOSITION_BUCKET_VALUES,
  compositionBucketSchema,
  type CompositionBucket,
} from "@/lib/config/enum-values";
import {
  accountRollup,
  blendedCost,
  effectiveFacts,
  portfolioBuckets,
} from "@/lib/pure/fund-facts";
import { interpolateAllocations } from "@/lib/calculators/random";
import { getAge, localDateStr } from "@/lib/utils/date";
import { getLatestMarketClose } from "@/server/helpers/market-prices";
import { getSecConnection } from "@/lib/sec/connection";
import { syncSecurityFacts } from "@/lib/sec/facts-sync";
import { toFactRows } from "@/server/helpers/fund-facts";
import { loadAccounts, loadLatestHoldings } from "./_shared";

type Db = typeof import("@/lib/db").db;

/** Target allocation by asset class for the primary person's age (the engine's own interpolation). */
async function targetByAssetClass(
  db: Db,
): Promise<{ age: number | null; target: Record<number, number> }> {
  const [person] = await db
    .select({ dob: schema.people.dateOfBirth })
    .from(schema.people)
    .where(eq(schema.people.isPrimaryUser, true))
    .limit(1);
  if (!person) return { age: null, target: {} };
  const age = getAge(new Date(`${person.dob}T00:00:00`), new Date());
  const rows = await db.select().from(schema.glidePathAllocations);
  const byAge = new Map<number, Record<number, number>>();
  for (const r of rows) {
    const a = byAge.get(r.age) ?? {};
    a[r.assetClassId] = Number(r.allocation);
    byAge.set(r.age, a);
  }
  const glidePath = [...byAge.entries()]
    .sort(([a], [b]) => a - b)
    .map(([gpAge, allocations]) => ({ age: gpAge, allocations }));
  return { age, target: interpolateAllocations(glidePath, age) };
}

const userFactsInput = z.object({
  securityId: z.number().int(),
  expenseRatio: z.number().min(0).max(0.2).nullable().optional(),
  composition: z
    .partialRecord(compositionBucketSchema, z.number().min(0).max(1))
    .optional()
    .refine(
      (c) =>
        c === undefined ||
        Math.abs(Object.values(c).reduce((s, v) => s + v, 0) - 1) <= 0.005,
      { message: "The mix must add up to 100%" },
    ),
});

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

/** How often "Check now" may re-check one suggested stand-in. */
const CHECK_STANDIN_COOLDOWN_MS = 60 * 60 * 1000;

export const investmentFundFactsRouter = createTRPCRouter({
  /** Holdings valued today, with each fund's facts; allocation vs target; blended cost. */
  getHoldingsOverview: portfolioProcedure.query(async ({ ctx }) => {
    const [holdings, accounts, sec, assetClasses, target] = await Promise.all([
      loadLatestHoldings(ctx.db),
      loadAccounts(ctx.db),
      getSecConnection(ctx.db),
      ctx.db
        .select({
          id: schema.assetClassParams.id,
          name: schema.assetClassParams.name,
          bucket: schema.assetClassParams.compositionBucket,
        })
        .from(schema.assetClassParams)
        .where(eq(schema.assetClassParams.isActive, true))
        .orderBy(schema.assetClassParams.sortOrder),
      targetByAssetClass(ctx.db),
    ]);
    const valued = await valueHoldings(ctx.db, holdings);

    const { buckets, unknown, total } = portfolioBuckets(valued);
    const mapped = new Set(assetClasses.map((a) => a.bucket).filter(Boolean));
    const byAccount = new Map<number, typeof valued>();
    for (const v of valued)
      byAccount.set(v.simplefinAccountId, [
        ...(byAccount.get(v.simplefinAccountId) ?? []),
        v,
      ]);

    return {
      secConnected: sec !== null,
      age: target.age,
      accounts: [...byAccount.entries()]
        .map(([id, rows]) => {
          const a = accounts.get(id);
          return {
            simplefinAccountId: id,
            performanceAccountId: a?.performanceAccountId ?? null,
            label: `${a?.institution ?? ""} ${a?.accountName ?? ""}`.trim(),
            total: rows.reduce((s, r) => s + r.value, 0),
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
          bucket: a.bucket,
          value: a.bucket ? buckets[a.bucket] : 0,
          targetPct: target.target[a.id] ?? null,
        })),
        unmapped: COMPOSITION_BUCKET_VALUES.filter(
          (b) => !mapped.has(b) && buckets[b] > 0.005,
        ).map((b) => ({ bucket: b, value: buckets[b] })),
      },
      cost: blendedCost(valued),
    };
  }),

  /** Use the suggested stand-in's SEC filings for this fund, and fetch them now. */
  confirmStandIn: portfolioProcedure
    .input(z.object({ securityId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const s = schema.securities;
      const updated = await ctx.db
        .update(s)
        .set({
          standinConfirmedAt: new Date(),
          standinPreview: null,
          factsCheckedAt: null,
        })
        .where(and(eq(s.id, input.securityId), eq(s.factsBasis, "standin")))
        .returning({ id: s.id });
      if (updated.length === 0)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No stand-in to confirm",
        });
      const summary = await syncSecurityFacts(ctx.db, {
        securityIds: [input.securityId],
      });
      return { fetched: summary.updated, stoppedBySec: summary.stoppedBySec };
    }),

  /**
   * Stop using a stand-in (suggested or already confirmed): no registered
   * fund fits. Facts that came from it are removed and it isn't suggested
   * again; your own entries are kept.
   */
  rejectStandIn: portfolioProcedure
    .input(z.object({ securityId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const s = schema.securities;
      const updated = await ctx.db
        .update(s)
        .set({
          factsBasis: "none",
          factsSeriesId: null,
          factsClassId: null,
          factsSeriesName: null,
          standinConfirmedAt: null,
          standinPreview: null,
        })
        .where(and(eq(s.id, input.securityId), eq(s.factsBasis, "standin")))
        .returning({ id: s.id });
      if (updated.length > 0) {
        const f = schema.securityFacts;
        await ctx.db
          .delete(f)
          .where(and(eq(f.securityId, input.securityId), ne(f.source, "user")));
      }
      return { ok: true as const };
    }),

  /**
   * Check a suggested (unconfirmed) stand-in's SEC filings now, to judge it
   * before using it. At most once an hour per fund unless the last check
   * failed — each check downloads several SEC files.
   */
  checkStandIn: portfolioProcedure
    .input(z.object({ securityId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const s = schema.securities;
      const [sec] = await ctx.db
        .select({ preview: s.standinPreview })
        .from(s)
        .where(
          and(
            eq(s.id, input.securityId),
            eq(s.factsBasis, "standin"),
            isNull(s.standinConfirmedAt),
          ),
        );
      if (!sec)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No suggested stand-in to check",
        });
      const last = sec.preview?.checkedAt
        ? Date.parse(sec.preview.checkedAt)
        : 0;
      if (!sec.preview?.error && Date.now() - last < CHECK_STANDIN_COOLDOWN_MS)
        return { checked: false, stoppedBySec: false, errors: [] };
      const summary = await syncSecurityFacts(ctx.db, {
        securityIds: [input.securityId],
      });
      return {
        checked: true,
        stoppedBySec: summary.stoppedBySec,
        errors: summary.errors,
      };
    }),

  /** After "Not a match": look for a stand-in again (asks SEC now). */
  findStandIn: portfolioProcedure
    .input(z.object({ securityId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const s = schema.securities;
      await ctx.db
        .update(s)
        .set({ factsBasis: null, factsCheckedAt: null })
        .where(and(eq(s.id, input.securityId), eq(s.factsBasis, "none")));
      const summary = await syncSecurityFacts(ctx.db, {
        securityIds: [input.securityId],
      });
      const [after] = await ctx.db
        .select({ name: s.factsSeriesName })
        .from(s)
        .where(eq(s.id, input.securityId));
      return {
        suggestion: after?.name ?? null,
        stoppedBySec: summary.stoppedBySec,
      };
    }),

  /** Remove your own expense ratio or mix for a fund, going back to SEC's (or none). */
  clearUserFacts: portfolioProcedure
    .input(
      z.object({
        securityId: z.number().int(),
        part: z.enum(["expenseRatio", "composition"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const f = schema.securityFacts;
      const mine = and(
        eq(f.securityId, input.securityId),
        eq(f.source, "user"),
      );
      await ctx.db
        .update(f)
        .set(
          input.part === "expenseRatio"
            ? { expenseRatio: null }
            : {
                usEquityPct: null,
                intlEquityPct: null,
                usBondPct: null,
                intlBondPct: null,
                tipsPct: null,
                cashPct: null,
                otherPct: null,
                coverage: null,
              },
        )
        .where(mine);
      // Rows left with nothing in them go away.
      await ctx.db
        .delete(f)
        .where(and(mine, isNull(f.expenseRatio), isNull(f.coverage)));
      return { ok: true as const };
    }),

  /** The household's own expense ratio and/or mix for a fund (e.g. from the plan's fee disclosure). */
  setUserFacts: portfolioProcedure
    .input(userFactsInput)
    .mutation(async ({ ctx, input }) => {
      const comp = input.composition;
      // Only the parts given are set; an existing entry for the other part stays.
      const values = {
        securityId: input.securityId,
        source: "user" as const,
        asOf: localDateStr(),
        ...(input.expenseRatio !== undefined
          ? {
              expenseRatio:
                input.expenseRatio === null
                  ? null
                  : input.expenseRatio.toFixed(6),
            }
          : {}),
        ...(comp
          ? {
              usEquityPct: (comp.us_equity ?? 0).toFixed(6),
              intlEquityPct: (comp.intl_equity ?? 0).toFixed(6),
              usBondPct: (comp.us_bond ?? 0).toFixed(6),
              intlBondPct: (comp.intl_bond ?? 0).toFixed(6),
              tipsPct: (comp.tips ?? 0).toFixed(6),
              cashPct: (comp.cash ?? 0).toFixed(6),
              otherPct: (comp.other ?? 0).toFixed(6),
              coverage: "1.000000",
            }
          : {}),
      };
      const f = schema.securityFacts;
      await ctx.db
        .insert(f)
        .values(values)
        .onConflictDoUpdate({
          target: [f.securityId, f.source, f.asOf],
          set: { ...values, fetchedAt: new Date() },
        });
      return { ok: true as const };
    }),

  /** Which composition bucket an asset class receives (null = none). */
  setCompositionBucket: portfolioProcedure
    .input(
      z.object({
        assetClassId: z.number().int(),
        bucket: compositionBucketSchema.nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const a = schema.assetClassParams;
      if (input.bucket) {
        // A bucket belongs to one asset class: release it elsewhere first.
        await ctx.db
          .update(a)
          .set({ compositionBucket: null })
          .where(eq(a.compositionBucket, input.bucket as CompositionBucket));
      }
      await ctx.db
        .update(a)
        .set({ compositionBucket: input.bucket })
        .where(eq(a.id, input.assetClassId));
      return { ok: true as const };
    }),
});
