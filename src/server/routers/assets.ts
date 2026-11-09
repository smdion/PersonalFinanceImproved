/** Asset management router covering home improvements, other assets, year-end history, and historical notes with API sync status. */
import { loansFedBySimplefin } from "@/server/services/sync/loan-feed";
import { calendarYear } from "@/lib/utils/date";
import { asc, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import { upsertHistoricalNote } from "@/server/data/historical-notes";
import { loadYearAssets } from "@/server/services/net-worth/year-assets";
import {
  computeMortgageBalance,
  getActiveMortgageLoan,
} from "@/lib/pure/debts/mortgage-balance";
import { getEffectiveCash } from "@/server/services/budget/account-balances";
import { toNumber } from "@/lib/utils/numbers";
import { getActiveBudgetApi } from "@/lib/budget-api";
import { zYearEndTargeting } from "@/lib/pure/net-worth/year-end-targeting.schema";
import { resolveCarryForwardAssetValue } from "@/lib/pure/net-worth/historical";
import { dropMappingsTo } from "@/server/data/delete-references";

export const assetsRouter = createTRPCRouter({
  /**
   * Asset-focused summary: current state + year-over-year history.
   * Includes API sync status per item so the UI can show sync badges.
   */
  computeSummary: protectedProcedure
    .input(zYearEndTargeting)
    .query(async ({ ctx, input }) => {
      const [
        { years, homeImprovements, otherAssets, notes },
        apiConnections,
        mortgageLoans,
        mortgageExtras,
        allSettings,
      ] = await Promise.all([
        loadYearAssets(ctx.db, ctx.scope.asOf, input),
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
          m.loanId != null ||
          (m.localId ?? m.localName).startsWith("mortgage:"),
      );

      // Cash sync status
      const { cash: currentCash, source: cashSource } = await getEffectiveCash(
        ctx.db,
        allSettings,
      );

      const activeLoan = getActiveMortgageLoan(mortgageLoans);
      const houseValue = activeLoan
        ? toNumber(
            activeLoan.propertyValueEstimated ??
              activeLoan.propertyValuePurchase,
          )
        : 0;
      const mortgageBalance = computeMortgageBalance(
        mortgageLoans,
        mortgageExtras,
        ctx.scope.asOf,
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
      const mortgageFromFeed =
        activeLoan != null &&
        (await loansFedBySimplefin(ctx.db)).has(activeLoan.id);
      const mortgageSynced =
        mortgageFromFeed ||
        (activeLoan
          ? mortgageMappings.some((m) => {
              if (m.loanId === activeLoan.id && m.loanMapType === "loanBalance")
                return true;
              const lid = m.localId ?? m.localName;
              return lid === `mortgage:${activeLoan.id}:loanBalance`;
            })
          : false);

      const currentYear = ctx.scope.asOf.getFullYear();

      // Current year other asset items (carry-forward: latest value per name where year <= target)
      const uniqueAssetNames = Array.from(
        new Set(otherAssets.map((a) => a.name)),
      );
      const currentOtherAssetItems: Array<{
        id: number;
        name: string;
        value: number;
        note: string | null;
        synced: boolean;
        yearRecorded: number;
      }> = [];
      for (const name of uniqueAssetNames) {
        const resolved = resolveCarryForwardAssetValue(
          otherAssets,
          name,
          currentYear,
        );
        if (resolved) {
          currentOtherAssetItems.push({
            id: resolved.id!,
            name,
            value: resolved.value,
            note: resolved.note,
            synced: mappedAssetIds.has(resolved.id!),
            yearRecorded: resolved.yearRecorded,
          });
        }
      }

      // Year-over-year history rows (compact)
      const history = years.map(({ row, assets }) => ({
        year: row.year,
        isCurrent: row.isCurrent,
        cash: row.cash,
        houseValue: row.houseValue,
        homeImprovements: assets.homeImprovements,
        homeImprovementItems: assets.homeImprovementItems,
        otherAssets: assets.otherAssets,
        otherAssetItems: assets.otherAssetItems,
        mortgageBalance: row.mortgageBalance,
        totalAssets: row.cash + row.houseValue + assets.otherAssets,
      }));

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
          mortgageFromFeed,
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
          cost: toNumber(hi.cost),
          note: hi.note,
        })),
        notes,
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
      return { ok: true };
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
      return { ok: true };
    }),

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

  upsertNote: adminProcedure
    .input(
      z.object({
        year: z.number(),
        field: z.string().min(1),
        note: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await upsertHistoricalNote(ctx.db, input);
      return { ok: true };
    }),
});
