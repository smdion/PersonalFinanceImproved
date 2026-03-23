/** Sync connections router for CRUD operations on YNAB/Actual budget API credentials and connection status checks. */

import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import {
  getClientForService,
  getActiveBudgetApi,
  getApiConnection,
  cacheClear,
} from "@/lib/budget-api";
import type { YnabConfig, ActualConfig } from "@/lib/budget-api";

const serviceEnum = z.enum(["ynab", "actual"]);

export const syncConnectionsRouter = createTRPCRouter({
  /** Get connection status for each service (not just the active one) */
  getConnection: protectedProcedure.query(async ({ ctx }) => {
    const active = await getActiveBudgetApi(ctx.db);
    const [ynabConn, actualConn] = await Promise.all([
      getApiConnection(ctx.db, "ynab"),
      getApiConnection(ctx.db, "actual"),
    ]);

    return {
      activeApi: active,
      ynab: ynabConn
        ? { connected: true, lastSyncedAt: ynabConn.lastSyncedAt }
        : { connected: false, lastSyncedAt: null },
      actual: actualConn
        ? { connected: true, lastSyncedAt: actualConn.lastSyncedAt }
        : { connected: false, lastSyncedAt: null },
    };
  }),

  /** Save (upsert) a budget API connection */
  saveConnection: adminProcedure
    .input(
      z.discriminatedUnion("service", [
        z.object({
          service: z.literal("ynab"),
          accessToken: z.string().min(1),
          budgetId: z.string().min(1),
        }),
        z.object({
          service: z.literal("actual"),
          serverUrl: z.string().url(),
          apiKey: z.string().min(1),
          budgetSyncId: z.string().min(1),
        }),
      ]),
    )
    .mutation(async ({ ctx, input }) => {
      const config: YnabConfig | ActualConfig =
        input.service === "ynab"
          ? { accessToken: input.accessToken, budgetId: input.budgetId }
          : {
              serverUrl: input.serverUrl,
              apiKey: input.apiKey,
              budgetSyncId: input.budgetSyncId,
            };

      // Single atomic upsert — onConflictDoUpdate is already transactional in
      // Postgres (the INSERT … ON CONFLICT DO UPDATE runs as one statement).
      // No explicit transaction wrapper needed.
      await ctx.db
        .insert(schema.apiConnections)
        .values({
          service: input.service,
          config,
        })
        .onConflictDoUpdate({
          target: schema.apiConnections.service,
          set: { config },
        });

      return { success: true };
    }),

  /** Fetch YNAB budgets list using a raw token (before saving connection) */
  fetchYnabBudgets: adminProcedure
    .input(z.object({ accessToken: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        const res = await fetch("https://api.ynab.com/v1/budgets", {
          headers: { Authorization: `Bearer ${input.accessToken}` },
        });
        if (!res.ok) {
          const text = await res.text();
          return {
            success: false as const,
            error: `YNAB API error ${res.status}: ${text}`,
          };
        }
        const json = (await res.json()) as {
          data: {
            budgets: Array<{
              id: string;
              name: string;
              last_modified_on: string;
            }>;
          };
        };
        return {
          success: true as const,
          budgets: json.data.budgets.map((b) => ({
            id: b.id,
            name: b.name,
            lastModified: b.last_modified_on,
          })),
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        return {
          success: false as const,
          error: msg.slice(0, 200),
        };
      }
    }),

  /** Test a specific service connection (works before activation) */
  testConnection: adminProcedure
    .input(z.object({ service: serviceEnum }))
    .mutation(async ({ ctx, input }) => {
      const client = await getClientForService(ctx.db, input.service);
      if (!client) {
        return {
          success: false,
          error: `No ${input.service} connection configured`,
        };
      }

      try {
        // getBudgetName implicitly tests the connection — no need to call both
        const budgetName = await client.getBudgetName();
        return { success: true, budgetName };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        return {
          success: false,
          error: msg.slice(0, 200),
        };
      }
    }),

  /** Delete a connection and clear its cache */
  deleteConnection: adminProcedure
    .input(z.object({ service: serviceEnum }))
    .mutation(async ({ ctx, input }) => {
      await cacheClear(ctx.db, input.service);
      await ctx.db
        .delete(schema.apiConnections)
        .where(eq(schema.apiConnections.service, input.service));

      // If we're deleting the active API, reset to 'none'
      const active = await getActiveBudgetApi(ctx.db);
      if (active === input.service) {
        await ctx.db
          .insert(schema.appSettings)
          .values({ key: "active_budget_api", value: "none" })
          .onConflictDoUpdate({
            target: schema.appSettings.key,
            set: { value: "none" },
          });
      }

      return { success: true };
    }),

  /** Get sync status for the active API */
  getSyncStatus: protectedProcedure.query(async ({ ctx }) => {
    const active = await getActiveBudgetApi(ctx.db);
    if (active === "none") {
      return { service: null, connected: false, lastSynced: null };
    }

    const conn = await getApiConnection(ctx.db, active);
    return {
      service: active,
      connected: !!conn,
      lastSynced: conn?.lastSyncedAt ?? null,
    };
  }),
});
