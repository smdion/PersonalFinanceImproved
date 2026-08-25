/**
 * Tax Buckets analysis router — real current-state tax-bucket breakdown,
 * Rule of 55 / Roth-basis-driven early-access flags, and the manual-entry
 * mutations (Roth basis, separation date) it depends on.
 *
 * Standalone tool: independent of the Retirement page's own scenario/
 * profile-pin system, per design — the target-retirement-age lever lives
 * entirely on the client and is passed as a query input.
 */
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import {
  createTRPCRouter,
  protectedProcedure,
  performanceProcedure,
} from "../trpc";
import * as schema from "@/lib/db/schema";
import { getLatestSnapshot } from "@/server/helpers/snapshot";
import { computeTaxBucketBreakdown } from "@/lib/pure/tax-buckets";
import { computeTaxBucketAnalysis } from "@/lib/pure/tax-bucket-analysis";
import type { AccountCategory } from "@/lib/calculators/types";

const GetBreakdownInput = z.object({
  targetRetirementAges: z
    .array(z.object({ personId: z.number().int(), age: z.number() }))
    .default([]),
});

export const taxBucketsRouter = createTRPCRouter({
  /** Real current-state tax-bucket breakdown from the latest snapshot, with
   *  Rule of 55 / Roth-basis-driven penalty-free/tax-free flags per account. */
  getBreakdown: protectedProcedure
    .input(GetBreakdownInput)
    .query(async ({ ctx, input }) => {
      const [people, perfAccounts, snapshotData, rothBasisRows, contribLinks] =
        await Promise.all([
          ctx.db.select().from(schema.people),
          ctx.db.select().from(schema.performanceAccounts),
          getLatestSnapshot(ctx.db),
          ctx.db.select().from(schema.rothBasis),
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

      const targetRetirementAgeByPerson = Object.fromEntries(
        input.targetRetirementAges.map((t) => [t.personId, t.age]),
      );

      const breakdown = computeTaxBucketBreakdown(
        snapshotData,
        people.map((p) => ({ id: p.id, name: p.name })),
        perfAccounts.map((p) => ({
          isActive: p.isActive,
          accountType: p.accountType,
          costBasis: p.costBasis,
        })),
      );

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
        rothBasisRows: rothBasisRows.map((r) => ({
          performanceAccountId: r.performanceAccountId,
          ownerPersonId: r.ownerPersonId,
          contributionBasis: Number(r.contributionBasis ?? "0"),
          conversionBasis: Number(r.conversionBasis ?? "0"),
          latestConversionYear: r.latestConversionYear,
          asOfDate: new Date(r.asOfDate),
        })),
        people: people.map((p) => ({
          id: p.id,
          name: p.name,
          birthYear: new Date(p.dateOfBirth).getUTCFullYear(),
        })),
        targetRetirementAgeByPerson,
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

  /** Upsert Roth contribution/conversion basis for one (account, owner) pair. */
  updateRothBasis: performanceProcedure
    .input(
      z.object({
        performanceAccountId: z.number().int(),
        ownerPersonId: z.number().int(),
        contributionBasis: z.string(),
        conversionBasis: z.string(),
        latestConversionYear: z.number().int().nullable(),
        notes: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(schema.rothBasis)
        .values({
          performanceAccountId: input.performanceAccountId,
          ownerPersonId: input.ownerPersonId,
          contributionBasis: input.contributionBasis,
          conversionBasis: input.conversionBasis,
          latestConversionYear: input.latestConversionYear,
          asOfDate: new Date().toISOString().slice(0, 10),
          notes: input.notes ?? null,
        })
        .onConflictDoUpdate({
          target: [
            schema.rothBasis.performanceAccountId,
            schema.rothBasis.ownerPersonId,
          ],
          set: {
            contributionBasis: input.contributionBasis,
            conversionBasis: input.conversionBasis,
            latestConversionYear: input.latestConversionYear,
            asOfDate: new Date().toISOString().slice(0, 10),
            notes: input.notes ?? null,
          },
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
