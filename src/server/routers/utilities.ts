/** House utilities tracker — metered services (gas/water/electric) and monthly readings. */
import { asc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import { toNumber } from "@/server/helpers";
import { zDecimal } from "./settings/_shared";
import { utilityKindSchema, utilityUnitSchema } from "@/lib/config/enum-values";
import { safeDivide } from "@/lib/utils/math";

// ── Shared field validators ──
// Year/month bounded per RULES.md "Validation Consistency"; decimal columns use
// the shared `zDecimal` (string input) — never bare z.number()/z.string().

const yearSchema = z.number().int().min(1900).max(2100);
const monthSchema = z.number().int().min(1).max(12);

/** Reading value fields, shared between upsertReading and updateReading. */
const readingValueFields = {
  cost: zDecimal,
  usage: zDecimal.nullable().optional(),
  note: z.string().nullable().optional(),
};

/** Service editable fields, shared between upsertService and updateService. */
const serviceEditableFields = {
  providerName: z.string().min(1),
  usageUnit: utilityUnitSchema.nullable().optional(),
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional(),
};

/** Per-reading row returned to the client, with $/unit computed (never stored). */
type ReadingSummary = {
  id: number;
  month: number;
  cost: number;
  usage: number | null;
  note: string | null;
  costPerUnit: number | null;
};

/** Per-year aggregate for one service. All values derived at read time. */
type YearSummary = {
  year: number;
  readingCount: number;
  totalCost: number;
  avgCost: number;
  minCost: number;
  maxCost: number;
  /** null when no reading in the year carried a usage value. */
  totalUsage: number | null;
  avgUsage: number | null;
  minUsage: number | null;
  maxUsage: number | null;
  /** totalCost / totalUsage; null when usage is missing/zero. */
  costPerUnit: number | null;
  /** Year-over-year change in totalCost vs the prior year; null for the first year. */
  yoyCostPct: number | null;
  readings: ReadingSummary[];
};

export const utilitiesRouter = createTRPCRouter({
  /** All utility services ordered for display. */
  listServices: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(schema.utilityService)
      .orderBy(asc(schema.utilityService.sortOrder));
  }),

  /**
   * Full per-service, per-year summary. Loads the stored readings and computes
   * every derived value (total/avg/min/max cost & usage, $/unit, YoY) here.
   * Nothing derived is persisted.
   */
  computeSummary: protectedProcedure.query(async ({ ctx }) => {
    const [services, readings] = await Promise.all([
      ctx.db
        .select()
        .from(schema.utilityService)
        .orderBy(asc(schema.utilityService.sortOrder)),
      ctx.db.select().from(schema.utilityReading),
    ]);

    const readingsByService = new Map<number, typeof readings>();
    for (const r of readings) {
      const list = readingsByService.get(r.serviceId) ?? [];
      list.push(r);
      readingsByService.set(r.serviceId, list);
    }

    const summaries = services.map((svc) => {
      const svcReadings = readingsByService.get(svc.id) ?? [];

      // Group readings by year.
      const byYear = new Map<number, typeof svcReadings>();
      for (const r of svcReadings) {
        const list = byYear.get(r.year) ?? [];
        list.push(r);
        byYear.set(r.year, list);
      }

      const years: YearSummary[] = Array.from(byYear.keys())
        .sort((a, b) => a - b)
        .map((year) => {
          const rows = byYear
            .get(year)!
            .slice()
            .sort((a, b) => a.month - b.month);

          const costs = rows.map((r) => toNumber(r.cost));
          const usages = rows
            .filter((r) => r.usage != null)
            .map((r) => toNumber(r.usage));

          const totalCost = costs.reduce((s, c) => s + c, 0);
          const totalUsage =
            usages.length > 0 ? usages.reduce((s, u) => s + u, 0) : null;

          return {
            year,
            readingCount: rows.length,
            totalCost,
            avgCost: safeDivide(totalCost, costs.length) ?? 0,
            minCost: Math.min(...costs),
            maxCost: Math.max(...costs),
            totalUsage,
            avgUsage:
              totalUsage != null ? safeDivide(totalUsage, usages.length) : null,
            minUsage: usages.length > 0 ? Math.min(...usages) : null,
            maxUsage: usages.length > 0 ? Math.max(...usages) : null,
            costPerUnit:
              totalUsage != null
                ? safeDivide(totalCost, totalUsage, null)
                : null,
            yoyCostPct: null as number | null, // filled in below
            readings: rows.map((r) => {
              const usage = r.usage != null ? toNumber(r.usage) : null;
              return {
                id: r.id,
                month: r.month,
                cost: toNumber(r.cost),
                usage,
                note: r.note,
                costPerUnit:
                  usage != null
                    ? safeDivide(toNumber(r.cost), usage, null)
                    : null,
              };
            }),
          };
        });

      // YoY cost change, computed in ascending-year order.
      for (let i = 1; i < years.length; i++) {
        const prev = years[i - 1]!.totalCost;
        years[i]!.yoyCostPct = safeDivide(
          years[i]!.totalCost - prev,
          prev,
          null,
        );
      }

      const latest = years[years.length - 1] ?? null;

      return {
        serviceId: svc.id,
        kind: svc.kind,
        providerName: svc.providerName,
        usageUnit: svc.usageUnit,
        sortOrder: svc.sortOrder,
        active: svc.active,
        latestYear: latest?.year ?? null,
        latestYearTotalCost: latest?.totalCost ?? null,
        latestYearTotalUsage: latest?.totalUsage ?? null,
        latestCostPerUnit: latest?.costPerUnit ?? null,
        latestYoyCostPct: latest?.yoyCostPct ?? null,
        years,
      };
    });

    return { summaries };
  }),

  /** Create or update a reading by its natural key (serviceId, year, month). */
  upsertReading: adminProcedure
    .input(
      z.object({
        serviceId: z.number().int().positive(),
        year: yearSchema,
        month: monthSchema,
        ...readingValueFields,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(schema.utilityReading)
        .values({
          serviceId: input.serviceId,
          year: input.year,
          month: input.month,
          cost: input.cost,
          usage: input.usage ?? null,
          note: input.note ?? null,
        })
        .onConflictDoUpdate({
          target: [
            schema.utilityReading.serviceId,
            schema.utilityReading.year,
            schema.utilityReading.month,
          ],
          set: {
            cost: input.cost,
            usage: input.usage ?? null,
            note: input.note ?? null,
          },
        });
      return { success: true };
    }),

  /** Update a reading's values by id (key fields stay fixed). */
  updateReading: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        cost: readingValueFields.cost.optional(),
        usage: readingValueFields.usage,
        note: readingValueFields.note,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updates: Record<string, string | null> = {};
      if (input.cost !== undefined) updates.cost = input.cost;
      if (input.usage !== undefined) updates.usage = input.usage ?? null;
      if (input.note !== undefined) updates.note = input.note ?? null;
      if (Object.keys(updates).length > 0) {
        await ctx.db
          .update(schema.utilityReading)
          .set(updates)
          .where(eq(schema.utilityReading.id, input.id));
      }
      return { success: true };
    }),

  deleteReading: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(schema.utilityReading)
        .where(eq(schema.utilityReading.id, input.id));
      return { success: true };
    }),

  /** Create or update a service by its kind (unique). */
  upsertService: adminProcedure
    .input(
      z.object({
        kind: utilityKindSchema,
        ...serviceEditableFields,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(schema.utilityService)
        .values({
          kind: input.kind,
          providerName: input.providerName,
          usageUnit: input.usageUnit ?? null,
          sortOrder: input.sortOrder ?? 0,
          active: input.active ?? true,
        })
        .onConflictDoUpdate({
          target: [schema.utilityService.kind],
          set: {
            providerName: input.providerName,
            usageUnit: input.usageUnit ?? null,
            ...(input.sortOrder !== undefined
              ? { sortOrder: input.sortOrder }
              : {}),
            ...(input.active !== undefined ? { active: input.active } : {}),
          },
        });
      return { success: true };
    }),

  /** Update editable fields of an existing service by id (kind is immutable). */
  updateService: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        providerName: serviceEditableFields.providerName.optional(),
        usageUnit: serviceEditableFields.usageUnit,
        sortOrder: serviceEditableFields.sortOrder,
        active: serviceEditableFields.active,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updates: Record<string, string | number | boolean | null> = {};
      if (input.providerName !== undefined)
        updates.providerName = input.providerName;
      if (input.usageUnit !== undefined)
        updates.usageUnit = input.usageUnit ?? null;
      if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;
      if (input.active !== undefined) updates.active = input.active;
      if (Object.keys(updates).length > 0) {
        await ctx.db
          .update(schema.utilityService)
          .set(updates)
          .where(eq(schema.utilityService.id, input.id));
      }
      return { success: true };
    }),
});
