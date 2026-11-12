/** Asset management router covering home improvements, other assets, year-end history, and historical notes with API sync status. */
import { calendarYear } from "@/lib/utils/date";
import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { zMoneyNumber, zYear } from "@/lib/utils/zod-fields";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import { upsertHistoricalNote } from "@/server/data/historical-notes";
import { toNumber } from "@/lib/utils/numbers";
import { zYearEndTargeting } from "@/lib/pure/net-worth/year-end-targeting.schema";
import { dropMappingsTo } from "@/server/data/delete-references";
import { computeAssetSummary } from "@/server/services/net-worth/year-assets";

export const assetsRouter = createTRPCRouter({
  /** Current assets and year-over-year history, with each item's API sync
   *  status (the sync badges). */
  computeSummary: protectedProcedure
    .input(zYearEndTargeting)
    .query(({ ctx, input }) => computeAssetSummary(ctx, input)),

  /** Update simple asset fields (cash, houseValue) on a net_worth_annual row. */
  updateAsset: adminProcedure
    .input(
      z.object({
        year: zYear,
        fields: z.object({
          cash: zMoneyNumber.optional(),
          houseValue: zMoneyNumber.optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { year, fields } = input;

      const rows = await ctx.db.select().from(schema.netWorthAnnual);
      const row = rows.find((r) => calendarYear(r.yearEndDate) === year);
      if (!row) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `No year-end history found for ${year}.`,
        });
      }

      const updates: Record<string, string> = {};
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined /* superjson keeps a key sent as undefined */) {
          updates[key] = String(value);
        }
      }

      if (Object.keys(updates).length === 0) return { ok: true };

      await ctx.db
        .update(schema.netWorthAnnual)
        .set(updates)
        .where(eq(schema.netWorthAnnual.id, row.id));

      return { ok: true };
    }),

  // --- Home Improvement Items ---

  addHomeImprovement: adminProcedure
    .input(
      z.object({
        year: zYear,
        description: z.string().min(1),
        cost: zMoneyNumber,
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db.insert(schema.homeImprovementItems).values({
        year: input.year,
        description: input.description,
        cost: String(input.cost),
        note: input.note ?? null,
      });
      return { ok: true };
    }),

  updateHomeImprovement: adminProcedure
    .input(
      z.object({
        id: z.number(),
        description: z.string().min(1).optional(),
        cost: zMoneyNumber.optional(),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updates: Record<string, string | null> = {};
      if (input.description !== undefined)
        updates.description = input.description;
      if (input.cost !== undefined) updates.cost = String(input.cost);
      if (input.note !== undefined) updates.note = input.note || null;
      if (Object.keys(updates).length > 0) {
        await ctx.db
          .update(schema.homeImprovementItems)
          .set(updates)
          .where(eq(schema.homeImprovementItems.id, input.id));
      }
      return { ok: true };
    }),

  deleteHomeImprovement: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(schema.homeImprovementItems)
        .where(eq(schema.homeImprovementItems.id, input.id));
      return { ok: true };
    }),

  // --- Other Asset Items ---

  /** Set an other asset's value for a year, keyed by name and year. */
  upsertOtherAsset: adminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        year: zYear,
        value: zMoneyNumber,
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(schema.otherAssetItems)
        .values({
          name: input.name,
          year: input.year,
          value: String(input.value),
          note: input.note ?? null,
        })
        .onConflictDoUpdate({
          target: [schema.otherAssetItems.name, schema.otherAssetItems.year],
          set: {
            value: String(input.value),
            note: input.note ?? null,
          },
        });
      return { ok: true };
    }),

  /** Delete an other asset and the budget-API mappings that point at it. */
  deleteOtherAsset: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        await dropMappingsTo(tx, { assetId: input.id });
        await tx
          .delete(schema.otherAssetItems)
          .where(eq(schema.otherAssetItems.id, input.id));
      });
      return { ok: true };
    }),

  // --- Property Taxes ---

  /** Property taxes by year, newest first, for one loan or all; with none, year-end history's figures stand in (id 0). */
  listPropertyTaxes: protectedProcedure
    .input(z.object({ loanId: z.number() }).optional())
    .query(async ({ ctx, input }) => {
      const rows = input?.loanId
        ? await ctx.db
            .select()
            .from(schema.propertyTaxes)
            .where(eq(schema.propertyTaxes.loanId, input.loanId))
            .orderBy(desc(schema.propertyTaxes.year))
        : await ctx.db
            .select()
            .from(schema.propertyTaxes)
            .orderBy(desc(schema.propertyTaxes.year));

      if (rows.length > 0) {
        return rows.map((r) => ({
          ...r,
          assessedValue: r.assessedValue ? toNumber(r.assessedValue) : null,
          taxAmount: toNumber(r.taxAmount),
        }));
      }

      // Fallback: pull from net_worth_annual when property_taxes table is empty
      const annualRows = await ctx.db
        .select({
          yearEndDate: schema.netWorthAnnual.yearEndDate,
          propertyTaxes: schema.netWorthAnnual.propertyTaxes,
        })
        .from(schema.netWorthAnnual)
        .orderBy(desc(schema.netWorthAnnual.yearEndDate));

      return annualRows
        .filter((r) => r.propertyTaxes != null)
        .map((r) => ({
          id: 0,
          loanId: input?.loanId ?? 0,
          year: calendarYear(r.yearEndDate),
          assessedValue: null,
          taxAmount: toNumber(r.propertyTaxes!),
          note: "From historical records",
        }));
    }),

  /** Set a loan's property tax for a year, keyed by loan and year. */
  upsertPropertyTax: adminProcedure
    .input(
      z.object({
        loanId: z.number(),
        year: zYear,
        assessedValue: zMoneyNumber.nullable().optional(),
        taxAmount: zMoneyNumber,
        note: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(schema.propertyTaxes)
        .values({
          loanId: input.loanId,
          year: input.year,
          assessedValue:
            input.assessedValue != null ? String(input.assessedValue) : null,
          taxAmount: String(input.taxAmount),
          note: input.note ?? null,
        })
        .onConflictDoUpdate({
          target: [schema.propertyTaxes.loanId, schema.propertyTaxes.year],
          set: {
            assessedValue:
              input.assessedValue != null ? String(input.assessedValue) : null,
            taxAmount: String(input.taxAmount),
            note: input.note ?? null,
          },
        });
      return { ok: true };
    }),

  deletePropertyTax: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(schema.propertyTaxes)
        .where(eq(schema.propertyTaxes.id, input.id));
      return { ok: true };
    }),

  // --- Notes ---

  /** Save the note on one year's field; a blank note deletes it. */
  upsertNote: adminProcedure
    .input(
      z.object({
        year: zYear,
        field: z.string().min(1),
        note: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await upsertHistoricalNote(ctx.db, input);
      return { ok: true };
    }),
});
