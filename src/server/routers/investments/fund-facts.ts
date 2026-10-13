/**
 * Fund facts on the Benchmarks page: what each holding is worth today, what
 * it holds, what it costs, and the household's own answers where SEC has
 * none (confirm or reject a stand-in, enter facts, link asset classes).
 * portfolioProcedure throughout — holdings, values and allocation.
 */
import { z } from "zod/v4";
import { and, eq, isNull, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, portfolioProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import {
  compositionBucketSchema,
  type CompositionBucket,
} from "@/lib/config/enum-values";
import { localDateStr } from "@/lib/utils/date";
import { syncSecurityFacts } from "@/lib/sec/facts-sync";
import { loadHoldingsOverview } from "./holdings-overview";

/** How far a hand-entered mix may stray from 100% (rounding). */
const MIX_TOTAL_TOLERANCE = 0.005;

const userFactsInput = z.object({
  securityId: z.number().int(),
  expenseRatio: z.number().min(0).max(0.2).nullable().optional(),
  composition: z
    .partialRecord(compositionBucketSchema, z.number().min(0).max(1))
    .optional()
    .refine(
      (c) =>
        c === undefined ||
        Math.abs(Object.values(c).reduce((s, v) => s + v, 0) - 1) <=
          MIX_TOTAL_TOLERANCE,
      { message: "The mix must add up to 100%" },
    ),
});

/** How often "Check now" may re-check one suggested stand-in. */
const CHECK_STANDIN_COOLDOWN_MS = 60 * 60 * 1000;

export const investmentFundFactsRouter = createTRPCRouter({
  /** Holdings valued today, with each fund's facts; allocation vs target; blended cost. */
  /** Holdings valued today, with each fund's facts; allocation vs target; blended cost. */
  getHoldingsOverview: portfolioProcedure.query(({ ctx }) =>
    loadHoldingsOverview(ctx.db),
  ),

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

  /**
   * Which asset class a fund category counts toward (null = none). Several
   * categories may count toward one class; a category toward one class.
   */
  linkCompositionBucket: portfolioProcedure
    .input(
      z.object({
        bucket: compositionBucketSchema,
        assetClassId: z.number().int().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const l = schema.assetClassBuckets;
      const bucket = input.bucket as CompositionBucket;
      if (input.assetClassId === null) {
        await ctx.db.delete(l).where(eq(l.bucket, bucket));
        return { ok: true as const };
      }
      const a = schema.assetClassParams;
      const [cls] = await ctx.db
        .select({ id: a.id })
        .from(a)
        .where(and(eq(a.id, input.assetClassId), eq(a.isActive, true)));
      if (!cls)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No such asset class",
        });
      await ctx.db
        .insert(l)
        .values({ bucket, assetClassId: cls.id })
        .onConflictDoUpdate({
          target: l.bucket,
          set: { assetClassId: cls.id },
        });
      return { ok: true as const };
    }),
});
