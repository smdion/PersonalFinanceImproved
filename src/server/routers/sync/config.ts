/** Sync config router for managing the active budget API selection, linked profile/column settings, and category skip/unskip rules. */

import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  syncProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { getActiveBudgetApi, getApiConnection } from "@/lib/budget-api";
import type { ActualConfig } from "@/lib/budget-api";
import { readMaybeEncrypted } from "@/lib/crypto";
import { serviceEnum } from "./_shared";

const YNAB_APP_URL = "https://app.youneedabudget.com/";

export const syncConfigRouter = createTRPCRouter({
  /** Get the current active_budget_api setting */
  getActiveBudgetApi: protectedProcedure.query(async ({ ctx }) => {
    return getActiveBudgetApi(ctx.db);
  }),

  /** URL for the nav's "open budget API" link — YNAB always links to the
   *  hosted app; Actual only links once the household has set an External
   *  URL (its `serverUrl` is often a private/internal address a browser
   *  outside that network can't reach — see ActualConfig's docblock). */
  getActiveBudgetApiLink: protectedProcedure.query(async ({ ctx }) => {
    const active = await getActiveBudgetApi(ctx.db);
    if (active === "none") return { service: active, url: null } as const;
    if (active === "ynab")
      return { service: active, url: YNAB_APP_URL } as const;
    const conn = await getApiConnection(ctx.db, "actual");
    if (!conn) return { service: active, url: null } as const;
    const config = readMaybeEncrypted<ActualConfig>(conn.config);
    return { service: active, url: config.externalUrl ?? null } as const;
  }),

  /** Set the active_budget_api setting */
  setActiveBudgetApi: syncProcedure
    .input(z.object({ value: z.enum(["none", "ynab", "actual"]) }))
    .mutation(async ({ ctx, input }) => {
      if (input.value !== "none") {
        const conn = await getApiConnection(ctx.db, input.value);
        if (!conn) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `No ${input.value} connection configured. Save credentials first.`,
          });
        }
      }

      await ctx.db
        .insert(schema.appSettings)
        .values({ key: "active_budget_api", value: input.value })
        .onConflictDoUpdate({
          target: schema.appSettings.key,
          set: { value: input.value },
        });

      return { success: true };
    }),

  /** Set (or clear) which Ledgr budget profile syncs with the budget API. */
  setLinkedProfile: syncProcedure
    .input(
      z.object({
        service: serviceEnum,
        profileId: z.number().int().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.apiConnections)
        .set({ linkedProfileId: input.profileId })
        .where(eq(schema.apiConnections.service, input.service));
      return { ok: true };
    }),

  /** Set which budget column (mode) syncs with the budget API. */
  setLinkedColumn: syncProcedure
    .input(
      z.object({ service: serviceEnum, columnIndex: z.number().int().min(0) }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.apiConnections)
        .set({ linkedColumnIndex: input.columnIndex })
        .where(eq(schema.apiConnections.service, input.service));
      return { ok: true };
    }),

  /** Skip an API category — hide from "not in Ledgr" list */
  skipCategory: syncProcedure
    .input(z.object({ service: serviceEnum, categoryId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const conn = await getApiConnection(ctx.db, input.service);
      if (!conn)
        throw new TRPCError({ code: "NOT_FOUND", message: "No connection" });
      const current = conn.skippedCategoryIds ?? [];
      if (current.includes(input.categoryId)) return { ok: true };
      await ctx.db
        .update(schema.apiConnections)
        .set({ skippedCategoryIds: [...current, input.categoryId] })
        .where(eq(schema.apiConnections.service, input.service));
      return { ok: true };
    }),

  /** Unskip an API category — restore to "not in Ledgr" list */
  unskipCategory: syncProcedure
    .input(z.object({ service: serviceEnum, categoryId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const conn = await getApiConnection(ctx.db, input.service);
      if (!conn)
        throw new TRPCError({ code: "NOT_FOUND", message: "No connection" });
      const current = conn.skippedCategoryIds ?? [];
      await ctx.db
        .update(schema.apiConnections)
        .set({
          skippedCategoryIds: current.filter((id) => id !== input.categoryId),
        })
        .where(eq(schema.apiConnections.service, input.service));
      return { ok: true };
    }),
});
