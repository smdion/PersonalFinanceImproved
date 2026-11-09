/**
 * Tax Buckets analysis router — real current-state tax-bucket breakdown,
 * Rule of 55 / Roth-basis-driven early-access flags, and the manual-entry
 * mutations (Roth basis, separation date) it depends on.
 *
 * "Accessible now" reflects real, already-happened separation only — never
 * a hypothetical future retirement date. There is no target-retirement-age
 * input here; a planned future retirement isn't evidence Rule of 55 already
 * applies today.
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
import { getLatestSnapshot } from "@/server/data/snapshots";
import { toNumber } from "@/lib/utils/numbers";
import { zDecimal } from "@/lib/utils/zod-fields";
import { recordFill, zFillRecord } from "@/server/services/sync/fill-ledger";
import { computeTaxBucketBreakdown } from "@/lib/pure/accounts/tax-buckets";
import { computeTaxBucketAnalysis } from "@/lib/pure/accounts/tax-bucket-analysis";
import { selectCurrentRothBasisRow } from "@/lib/pure/accounts/roth-basis-rollover";
import { earlyAccessInputs } from "@/server/services/tax/early-access-inputs";
import type { DbOrTx } from "@/lib/db";
import { upsertSetting } from "@/server/data/settings";
import { writeStamp } from "@/lib/utils/clock";

/** Stamp basis_last_updated in app_settings — mirrors stampPerformanceUpdated
 *  (services/performance/last-updated.ts). Called on every real basis write
 *  (single or batch) so the sidebar Data Freshness display and the
 *  Performance page subtitle stay current automatically. */
async function stampBasisUpdated(db: DbOrTx) {
  const now = writeStamp().toISOString();
  await upsertSetting(db, "basis_last_updated", now);
}

export const taxBucketsRouter = createTRPCRouter({
  /** Real current-state tax-bucket breakdown from the latest snapshot, with
   *  Rule of 55 / Roth-basis-driven penalty-free/tax-free flags per account. */
  computeBreakdown: protectedProcedure.query(async ({ ctx }) => {
    const [
      people,
      perfAccounts,
      snapshotData,
      rothBasisRows,
      contributionLinks,
    ] = await Promise.all([
      ctx.db.select().from(schema.people),
      ctx.db.select().from(schema.performanceAccounts),
      getLatestSnapshot(ctx.db),
      ctx.db.select().from(schema.accountBasis),
      ctx.db
        .select({
          performanceAccountId:
            schema.contributionAccounts.performanceAccountId,
          jobId: schema.contributionAccounts.jobId,
        })
        .from(schema.contributionAccounts),
    ]);

    const jobs = await ctx.db.select().from(schema.jobs);

    const breakdown = computeTaxBucketBreakdown(
      snapshotData,
      people.map((p) => ({ id: p.id, name: p.name })),
      perfAccounts.map((p) => ({
        id: p.id,
        isActive: p.isActive,
        accountType: p.accountType,
        costBasis: p.costBasis,
      })),
    );

    const analysis = computeTaxBucketAnalysis({
      breakdown,
      ...earlyAccessInputs({
        jobs,
        jobLinkRows: contributionLinks,
        accountBasisRows: rothBasisRows,
        perfAccounts,
      }),
      people: people.map((p) => ({
        id: p.id,
        name: p.name,
        birthYear: new Date(p.dateOfBirth).getUTCFullYear(),
      })),
      currentDate: ctx.scope.asOf,
    });

    return {
      portfolioByTaxType: breakdown.portfolioByTaxType,
      accounts: analysis,
      people: people.map((p) => ({
        id: p.id,
        name: p.name,
        birthYear: new Date(p.dateOfBirth).getUTCFullYear(),
      })),
    };
  }),

  /** Upsert Roth contribution/conversion basis for one (account, owner)
   *  pair. Without an explicit `year`, targets that pair's current row
   *  (the same selection computeBreakdown uses) — no year-boundary awareness
   *  needed from the caller. An explicit `year` lets the caller
   *  deliberately correct an older, already-finalized year (no hard
   *  reject — matches how updateAccount already edits finalized
   *  accountPerformance rows elsewhere in this app; there is no
   *  unfinalizeYear escape hatch, so a hard reject would make a typo
   *  permanently uncorrectable). Editing a row always clears isSeeded. */
  updateRothBasis: performanceProcedure
    .input(
      z.object({
        performanceAccountId: z.number().int(),
        ownerPersonId: z.number().int(),
        year: z.number().int().optional(),
        contributionBasis: zDecimal,
        conversionBasis: zDecimal,
        latestConversionYear: z.number().int().nullable(),
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

  /** Update every (account, owner) Roth basis entry in one screen/save,
   *  mirroring performance.batchUpdateAccounts — each entry targets its
   *  own already-known current year (from computeBreakdown's rothBasisMeta),
   *  so no per-row year resolution is needed here. */
  batchUpdateRothBasis: performanceProcedure
    .input(
      z.object({
        entries: z.array(
          z.object({
            performanceAccountId: z.number().int(),
            ownerPersonId: z.number().int(),
            year: z.number().int(),
            contributionBasis: zDecimal,
            conversionBasis: zDecimal,
            latestConversionYear: z.number().int().nullable(),
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
