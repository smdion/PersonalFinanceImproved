/**
 * Tax Buckets: current tax-bucket breakdown, Rule of 55 / Roth-basis early-access flags
 * (from real past separation only, never a planned date), and their manual-entry mutations.
 */
import { z } from "zod/v4";
import { isCalendarDate } from "@/lib/utils/date";
import { eq, and } from "drizzle-orm";
import {
  createTRPCRouter,
  protectedProcedure,
  performanceProcedure,
} from "../trpc";
import * as schema from "@/lib/db/schema";
import { toNumber } from "@/lib/utils/numbers";
import { zDecimal, zYear } from "@/lib/utils/zod-fields";
import { recordFill, zFillRecord } from "@/server/services/sync/fill-ledger";
import { selectCurrentRothBasisRow } from "@/lib/pure/accounts/roth-basis-rollover";
import { taxBucketBreakdown } from "@/server/services/tax/tax-bucket-breakdown";
import type { DbOrTx } from "@/lib/db";
import { upsertSetting } from "@/server/data/settings";
import { writeStamp } from "@/lib/utils/clock";

/** Stamp basis_last_updated in app_settings on every basis write, keeping the sidebar
 *  Data Freshness and Performance subtitle current (like stampPerformanceUpdated). */
async function stampBasisUpdated(db: DbOrTx) {
  const now = writeStamp().toISOString();
  await upsertSetting(db, "basis_last_updated", now);
}

export const taxBucketsRouter = createTRPCRouter({
  /** Real current-state tax-bucket breakdown from the latest snapshot, with
   *  Rule of 55 / Roth-basis-driven penalty-free/tax-free flags per account. */
  computeBreakdown: protectedProcedure.query(({ ctx }) =>
    taxBucketBreakdown(ctx.db, ctx.scope.asOf),
  ),

  /** Upsert Roth basis for one (account, owner). Without `year`, targets the pair's current
   *  row (as computeBreakdown selects it); an explicit `year` may correct a finalized year
   *  (no unfinalize exists). Editing a row always clears isSeeded. */
  updateRothBasis: performanceProcedure
    .input(
      z.object({
        performanceAccountId: z.number().int(),
        ownerPersonId: z.number().int(),
        year: zYear.optional(),
        contributionBasis: zDecimal,
        conversionBasis: zDecimal,
        latestConversionYear: zYear.nullable(),
        notes: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let targetYear = input.year;
      if (targetYear == null) {
        const existingRows = await ctx.db
          .select()
          .from(schema.accountBasis)
          .where(
            and(
              eq(
                schema.accountBasis.performanceAccountId,
                input.performanceAccountId,
              ),
              eq(schema.accountBasis.ownerPersonId, input.ownerPersonId),
            ),
          );
        const current = selectCurrentRothBasisRow(
          existingRows.map((r) => ({
            id: r.id,
            performanceAccountId: r.performanceAccountId,
            ownerPersonId: r.ownerPersonId,
            year: r.year,
            contributionBasis: toNumber(r.contributionBasis),
            conversionBasis: toNumber(r.conversionBasis),
            latestConversionYear: r.latestConversionYear,
            isFinalized: r.isFinalized,
          })),
        );
        targetYear = current?.year ?? ctx.scope.asOf.getFullYear();
      }

      await ctx.db
        .insert(schema.accountBasis)
        .values({
          performanceAccountId: input.performanceAccountId,
          ownerPersonId: input.ownerPersonId,
          year: targetYear,
          contributionBasis: input.contributionBasis,
          conversionBasis: input.conversionBasis,
          latestConversionYear: input.latestConversionYear,
          isSeeded: false,
          updatedAt: writeStamp(),
          notes: input.notes ?? null,
        })
        .onConflictDoUpdate({
          target: [
            schema.accountBasis.performanceAccountId,
            schema.accountBasis.ownerPersonId,
            schema.accountBasis.year,
          ],
          set: {
            contributionBasis: input.contributionBasis,
            conversionBasis: input.conversionBasis,
            latestConversionYear: input.latestConversionYear,
            isSeeded: false,
            updatedAt: writeStamp(),
            notes: input.notes ?? null,
          },
        });
      await stampBasisUpdated(ctx.db);
      return { ok: true };
    }),

  /** Update every (account, owner) Roth basis entry in one save; each entry targets its
   *  known current year (computeBreakdown's rothBasisMeta). */
  batchUpdateRothBasis: performanceProcedure
    .input(
      z.object({
        entries: z.array(
          z.object({
            performanceAccountId: z.number().int(),
            ownerPersonId: z.number().int(),
            year: zYear,
            contributionBasis: zDecimal,
            conversionBasis: zDecimal,
            latestConversionYear: zYear.nullable(),
          }),
        ),
        /** Set when the figures were filled from SimpleFIN: what they
         *  counted, so the next fill adds only what's new. */
        simplefinFill: zFillRecord.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.entries.length === 0) return { ok: true };
      await ctx.db.transaction(async (tx) => {
        for (const e of input.entries) {
          await tx
            .insert(schema.accountBasis)
            .values({
              performanceAccountId: e.performanceAccountId,
              ownerPersonId: e.ownerPersonId,
              year: e.year,
              contributionBasis: e.contributionBasis,
              conversionBasis: e.conversionBasis,
              latestConversionYear: e.latestConversionYear,
              isSeeded: false,
              updatedAt: writeStamp(),
            })
            .onConflictDoUpdate({
              target: [
                schema.accountBasis.performanceAccountId,
                schema.accountBasis.ownerPersonId,
                schema.accountBasis.year,
              ],
              set: {
                contributionBasis: e.contributionBasis,
                conversionBasis: e.conversionBasis,
                latestConversionYear: e.latestConversionYear,
                isSeeded: false,
                updatedAt: writeStamp(),
              },
            });
        }
        await stampBasisUpdated(tx);
        if (input.simplefinFill)
          await recordFill(tx, "basis", input.simplefinFill, ctx.scope.asOf);
      });
      return { ok: true };
    }),

  /** Set the durable Rule of 55 source-of-truth date for a 401k/403b account. */
  updateSeparationDate: performanceProcedure
    .input(
      z.object({
        performanceAccountId: z.number().int(),
        separationDate: z
          .string()
          .refine(isCalendarDate, "Not a date (YYYY-MM-DD)")
          .nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.performanceAccounts)
        .set({ separationDate: input.separationDate })
        .where(eq(schema.performanceAccounts.id, input.performanceAccountId));
      return { ok: true };
    }),
});
