import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import {
  num,
  buildYearEndHistory,
  getEffectiveCash,
  computeMortgageBalance,
} from "@/server/helpers";
import { getActiveBudgetApi } from "@/lib/budget-api";

export const assetsRouter = createTRPCRouter({
  /**
   * Asset-focused summary: current state + year-over-year history.
   * Includes API sync status per item so the UI can show sync badges.
   */
  getSummary: protectedProcedure.query(async ({ ctx }) => {
    const [
      yearEndHistory,
      homeImprovements,
      otherAssets,
      notes,
      apiConnections,
      mortgageLoans,
      mortgageExtras,
      allSettings,
    ] = await Promise.all([
      buildYearEndHistory(ctx.db),
      ctx.db
        .select()
        .from(schema.homeImprovementItems)
        .orderBy(asc(schema.homeImprovementItems.year)),
      ctx.db
        .select()
        .from(schema.otherAssetItems)
        .orderBy(asc(schema.otherAssetItems.year)),
      ctx.db.select().from(schema.historicalNotes),
      ctx.db.select().from(schema.apiConnections),
      ctx.db.select().from(schema.mortgageLoans),
      ctx.db
        .select()
        .from(schema.mortgageExtraPayments)
        .orderBy(asc(schema.mortgageExtraPayments.paymentDate)),
      ctx.db.select().from(schema.appSettings),
    ]);

    const activeBudgetApi = await getActiveBudgetApi(ctx.db);

    // Build account mappings lookup from active API connection
    const conn = apiConnections.find((c) => c.service === activeBudgetApi);
    const mappings = conn?.accountMappings ?? [];
    const mappedAssetIds = new Set(
      mappings
        .filter(
          (m) =>
            m.assetId != null ||
            (m.localId ?? m.localName).startsWith("asset:"),
        )
        .map(
          (m) =>
            m.assetId ??
            parseInt((m.localId ?? m.localName).split(":")[1]!, 10),
        ),
    );
    // Build mortgage mapping lookup using typed fields with legacy fallback
    const mortgageMappings = mappings.filter(
      (m) =>
        m.loanId != null || (m.localId ?? m.localName).startsWith("mortgage:"),
    );

    // Cash sync status
    const { cash: currentCash, source: cashSource } = await getEffectiveCash(
      ctx.db,
      allSettings,
    );

    // Mortgage data
    const activeLoan = mortgageLoans.find((m) => m.isActive);
    const houseValue = activeLoan
      ? num(
          activeLoan.propertyValueEstimated ?? activeLoan.propertyValuePurchase,
        )
      : 0;
    const mortgageBalance = computeMortgageBalance(
      mortgageLoans,
      mortgageExtras,
    );

    // Determine sync status for house value and mortgage
    const houseValueSynced = activeLoan
      ? mortgageMappings.some((m) => {
          if (m.loanId === activeLoan.id && m.loanMapType === "propertyValue")
            return true;
          const lid = m.localId ?? m.localName;
          return lid === `mortgage:${activeLoan.id}:propertyValue`;
        })
      : false;
    const mortgageSynced = activeLoan
      ? mortgageMappings.some((m) => {
          if (m.loanId === activeLoan.id && m.loanMapType === "loanBalance")
            return true;
          const lid = m.localId ?? m.localName;
          return lid === `mortgage:${activeLoan.id}:loanBalance`;
        })
      : false;

    const allYears = yearEndHistory.map((r) => r.year);
    const currentYear = new Date().getFullYear();

    // Build home improvements cumulative by year
    const homeImpByYear = new Map<
      number,
      { items: typeof homeImprovements; cumulative: number }
    >();
    for (const year of allYears) {
      const itemsUpToYear = homeImprovements.filter((hi) => hi.year <= year);
      const cumulative = itemsUpToYear.reduce(
        (sum, hi) => sum + num(hi.cost),
        0,
      );
      const itemsThisYear = homeImprovements.filter((hi) => hi.year === year);
      homeImpByYear.set(year, { items: itemsThisYear, cumulative });
    }

    // Build other assets by year (carry-forward: latest value per name where year <= target)
    const uniqueAssetNames = Array.from(
      new Set(otherAssets.map((a) => a.name)),
    );

    // Current year other asset items (carry-forward)
    const currentOtherAssetItems: Array<{
      id: number;
      name: string;
      value: number;
      note: string | null;
      synced: boolean;
      yearRecorded: number;
    }> = [];
    for (const name of uniqueAssetNames) {
      const entries = otherAssets
        .filter((a) => a.name === name && a.year <= currentYear)
        .sort((a, b) => a.year - b.year);
      if (entries.length > 0) {
        const latest = entries[entries.length - 1]!;
        const val = num(latest.value);
        if (val > 0) {
          currentOtherAssetItems.push({
            id: latest.id,
            name,
            value: val,
            note: latest.note,
            synced: mappedAssetIds.has(latest.id),
            yearRecorded: latest.year,
          });
        }
      }
    }

    // Build other assets by year for history
    const otherAssetsByYear = new Map<
      number,
      {
        items: {
          id: number;
          name: string;
          value: number;
          note: string | null;
        }[];
        total: number;
      }
    >();
    for (const year of allYears) {
      const items: {
        id: number;
        name: string;
        value: number;
        note: string | null;
      }[] = [];
      for (const name of uniqueAssetNames) {
        const entries = otherAssets.filter(
          (a) => a.name === name && a.year <= year,
        );
        if (entries.length > 0) {
          const latest = entries[entries.length - 1]!;
          const val = num(latest.value);
          if (val > 0) {
            items.push({ id: latest.id, name, value: val, note: latest.note });
          }
        }
      }
      otherAssetsByYear.set(year, {
        items,
        total: items.reduce((s, i) => s + i.value, 0),
      });
    }

    // Build notes lookup
    const notesMap: Record<string, string> = {};
    for (const n of notes) {
      notesMap[`${n.year}:${n.field}`] = n.note;
    }

    // Year-over-year history rows (compact)
    const history = yearEndHistory.map((row) => {
      const hiData = homeImpByYear.get(row.year);
      const oaData = otherAssetsByYear.get(row.year);
      const oaTotal =
        oaData && oaData.items.length > 0 ? oaData.total : row.otherAssets;

      return {
        year: row.year,
        isCurrent: row.isCurrent,
        cash: row.cash,
        houseValue: row.houseValue,
        homeImprovements:
          hiData && hiData.items.length > 0
            ? hiData.cumulative
            : row.homeImprovements,
        homeImprovementItems:
          hiData?.items.map((i) => ({
            id: i.id,
            year: i.year,
            description: i.description,
            cost: num(i.cost),
            note: i.note,
          })) ?? [],
        otherAssets: oaTotal,
        otherAssetItems: oaData?.items ?? [],
        mortgageBalance: row.mortgageBalance,
        totalAssets: row.cash + row.houseValue + oaTotal,
      };
    });

    // Current state summary (top-level)
    const latestHistory =
      history.find((h) => h.isCurrent) ?? history[history.length - 1];
    const otherAssetsTotal = currentOtherAssetItems.reduce(
      (s, i) => s + i.value,
      0,
    );

    // A house "exists" if there's an active mortgage loan OR home improvements
    const hasHouse = !!activeLoan || homeImprovements.length > 0;

    return {
      current: {
        cash: currentCash,
        cashSource,
        houseValue,
        houseValueSynced,
        mortgageBalance,
        mortgageSynced,
        houseEquity: houseValue - mortgageBalance,
        homeImprovements: latestHistory?.homeImprovements ?? 0,
        otherAssetsTotal,
        otherAssetItems: currentOtherAssetItems,
        totalAssets: currentCash + houseValue + otherAssetsTotal,
        activeLoanName: activeLoan?.name ?? null,
        activeBudgetApi,
        hasHouse,
      },
      history,
      homeImprovements: homeImprovements.map((hi) => ({
        id: hi.id,
        year: hi.year,
        description: hi.description,
        cost: num(hi.cost),
        note: hi.note,
      })),
      notes: notesMap,
    };
  }),

  /** Update simple asset fields (cash, houseValue) on a net_worth_annual row. */
  updateAsset: adminProcedure
    .input(
      z.object({
        year: z.number(),
        fields: z.object({
          cash: z.number().optional(),
          houseValue: z.number().optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { year, fields } = input;

      const rows = await ctx.db.select().from(schema.netWorthAnnual);
      const row = rows.find(
        (r) => new Date(r.yearEndDate).getFullYear() === year,
      );
      if (!row) {
        throw new Error(`No net_worth_annual row found for year ${year}`);
      }

      const updates: Record<string, string> = {};
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) {
          updates[key] = String(value);
        }
      }

      if (Object.keys(updates).length === 0) return { success: true };

      await ctx.db
        .update(schema.netWorthAnnual)
        .set(updates)
        .where(eq(schema.netWorthAnnual.id, row.id));

      return { success: true };
    }),

  // --- Home Improvement Items ---

  addHomeImprovement: adminProcedure
    .input(
      z.object({
        year: z.number(),
        description: z.string().min(1),
        cost: z.number(),
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
      return { success: true };
    }),

  updateHomeImprovement: adminProcedure
    .input(
      z.object({
        id: z.number(),
        description: z.string().min(1).optional(),
        cost: z.number().optional(),
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
      return { success: true };
    }),

  deleteHomeImprovement: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(schema.homeImprovementItems)
        .where(eq(schema.homeImprovementItems.id, input.id));
      return { success: true };
    }),

  // --- Other Asset Items ---

  upsertOtherAsset: adminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        year: z.number(),
        value: z.number(),
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
      return { success: true };
    }),

  deleteOtherAsset: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(schema.otherAssetItems)
        .where(eq(schema.otherAssetItems.id, input.id));
      return { success: true };
    }),

  // --- Property Taxes ---

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
          assessedValue: r.assessedValue ? num(r.assessedValue) : null,
          taxAmount: num(r.taxAmount),
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
          year: new Date(r.yearEndDate).getFullYear(),
          assessedValue: null,
          taxAmount: num(r.propertyTaxes!),
          note: "From historical records",
        }));
    }),

  upsertPropertyTax: adminProcedure
    .input(
      z.object({
        loanId: z.number(),
        year: z.number(),
        assessedValue: z.number().nullable().optional(),
        taxAmount: z.number(),
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
      return { success: true };
    }),

  deletePropertyTax: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(schema.propertyTaxes)
        .where(eq(schema.propertyTaxes.id, input.id));
      return { success: true };
    }),

  // --- Notes ---

  upsertNote: adminProcedure
    .input(
      z.object({
        year: z.number(),
        field: z.string().min(1),
        note: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.note.trim() === "") {
        await ctx.db
          .delete(schema.historicalNotes)
          .where(
            and(
              eq(schema.historicalNotes.year, input.year),
              eq(schema.historicalNotes.field, input.field),
            ),
          );
      } else {
        await ctx.db
          .insert(schema.historicalNotes)
          .values({ year: input.year, field: input.field, note: input.note })
          .onConflictDoUpdate({
            target: [schema.historicalNotes.year, schema.historicalNotes.field],
            set: { note: input.note },
          });
      }
      return { success: true };
    }),
});
