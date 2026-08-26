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
import { eq, and } from "drizzle-orm";
import {
  createTRPCRouter,
  protectedProcedure,
  performanceProcedure,
} from "../trpc";
import * as schema from "@/lib/db/schema";
import { getLatestSnapshot } from "@/server/helpers/snapshot";
import { toNumber } from "@/server/helpers/transforms";
import { computeTaxBucketBreakdown } from "@/lib/pure/tax-buckets";
import { computeTaxBucketAnalysis } from "@/lib/pure/tax-bucket-analysis";
import {
  buildCurrentRothBasisMap,
  selectCurrentRothBasisRow,
} from "@/lib/pure/roth-basis-rollover";
import type { AccountCategory } from "@/lib/calculators/types";

export const taxBucketsRouter = createTRPCRouter({
  /** Real current-state tax-bucket breakdown from the latest snapshot, with
   *  Rule of 55 / Roth-basis-driven penalty-free/tax-free flags per account. */
  getBreakdown: protectedProcedure.query(async ({ ctx }) => {
    const [people, perfAccounts, snapshotData, rothBasisRows, contribLinks] =
      await Promise.all([
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
    const jobsById = new Map(jobs.map((j) => [j.id, j]));

    const jobLinks = contribLinks
      .filter(
        (c): c is { performanceAccountId: number; jobId: number } =>
          c.performanceAccountId != null && c.jobId != null,
      )
      .map((c) => {
        const job = jobsById.get(c.jobId);
        return {
          performanceAccountId: c.performanceAccountId,
          endDate: job?.endDate ? new Date(job.endDate) : null,
          isSpeculative: job?.isSpeculative ?? false,
        };
      });

    const breakdown = computeTaxBucketBreakdown(
      snapshotData,
      people.map((p) => ({ id: p.id, name: p.name })),
      perfAccounts.map((p) => ({
        isActive: p.isActive,
        accountType: p.accountType,
        costBasis: p.costBasis,
      })),
    );

    // Select the "current" row per (account, owner) pair from the full
    // year-scoped history — the latest non-finalized row, or the latest
    // finalized one if no successor was ever seeded. Never a single
    // global latest year: different pairs can have different histories.
    const currentRothBasisRows = Array.from(
      buildCurrentRothBasisMap(
        rothBasisRows.map((r) => ({
          id: r.id,
          performanceAccountId: r.performanceAccountId,
          ownerPersonId: r.ownerPersonId,
          year: r.year,
          contributionBasis: toNumber(r.contributionBasis),
          conversionBasis: toNumber(r.conversionBasis),
          latestConversionYear: r.latestConversionYear,
          isFinalized: r.isFinalized,
        })),
      ).values(),
    );
    const rothBasisById = new Map(rothBasisRows.map((r) => [r.id, r]));

    const analysis = computeTaxBucketAnalysis({
      breakdown,
      performanceAccounts: perfAccounts.map((p) => ({
        id: p.id,
        accountType: p.accountType as AccountCategory,
        ownerPersonId: p.ownerPersonId,
        isActive: p.isActive,
        separationDate: p.separationDate ? new Date(p.separationDate) : null,
        costBasis: Number(p.costBasis ?? "0"),
        accountLabel: p.accountLabel,
        displayName: p.displayName,
        institution: p.institution,
      })),
      jobLinks,
      rothBasisRows: currentRothBasisRows.map((r) => {
        const raw = rothBasisById.get(r.id)!;
        return {
          performanceAccountId: r.performanceAccountId,
          ownerPersonId: r.ownerPersonId,
          year: r.year,
          contributionBasis: r.contributionBasis,
          conversionBasis: r.conversionBasis,
          latestConversionYear: r.latestConversionYear,
          isSeeded: raw.isSeeded,
          updatedAt: new Date(raw.updatedAt),
        };
      }),
      people: people.map((p) => ({
        id: p.id,
        name: p.name,
        birthYear: new Date(p.dateOfBirth).getUTCFullYear(),
      })),
      currentDate: new Date(),
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
   *  (the same selection getBreakdown uses) — no year-boundary awareness
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
        contributionBasis: z.string(),
        conversionBasis: z.string(),
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
        targetYear = current?.year ?? new Date().getFullYear();
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
          updatedAt: new Date(),
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
            updatedAt: new Date(),
            notes: input.notes ?? null,
          },
        });
      return { success: true };
    }),

  /** Update every (account, owner) Roth basis entry in one screen/save,
   *  mirroring performance.batchUpdateAccounts — each entry targets its
   *  own already-known current year (from getBreakdown's rothBasisMeta),
   *  so no per-row year resolution is needed here. */
  batchUpdateRothBasis: performanceProcedure
    .input(
      z.object({
        entries: z.array(
          z.object({
            performanceAccountId: z.number().int(),
            ownerPersonId: z.number().int(),
            year: z.number().int(),
            contributionBasis: z.string(),
            conversionBasis: z.string(),
            latestConversionYear: z.number().int().nullable(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.entries.length === 0) return { success: true };
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
              updatedAt: new Date(),
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
                updatedAt: new Date(),
              },
            });
        }
      });
      return { success: true };
    }),

  /** Set the durable Rule of 55 source-of-truth date for a 401k/403b account. */
  updateSeparationDate: performanceProcedure
    .input(
      z.object({
        performanceAccountId: z.number().int(),
        separationDate: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.performanceAccounts)
        .set({ separationDate: input.separationDate })
        .where(eq(schema.performanceAccounts.id, input.performanceAccountId));
      return { success: true };
    }),
});
