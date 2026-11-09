/** Sync connections router for CRUD operations on YNAB/Actual budget API credentials and connection status checks.
 *  Managing a connection (save, test, edit, delete, list a token's budgets) is admin-only, for both services
 *  alike, as is the Integrations page that calls it; reading its status stays open to every signed-in user. */

import { clearUnmappedPulledBalances } from "@/server/services/sync/apply-pull-mapping";
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import {
  adminProcedure,
  createTRPCRouter,
  protectedProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import {
  getClientForService,
  getActiveBudgetApi,
  getApiConnection,
  cacheClear,
} from "@/lib/budget-api";
import type { YnabConfig, ActualConfig } from "@/lib/budget-api";
import { encryptJson, readMaybeEncrypted } from "@/lib/crypto";
import { checkOutboundUrl } from "@/lib/http/url-safety";
import type { ProbeResult } from "@/lib/http/probe-result";
import { TRPCError } from "@trpc/server";
import { BudgetApiError, userMessageFor } from "@/lib/budget-api/errors";
import { listYnabBudgets } from "@/lib/budget-api/ynab-client";
import { serviceEnum } from "./_shared";
import { upsertSetting } from "@/server/data/settings";

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
        ? {
            connected: true,
            lastSyncedAt: actualConn.lastSyncedAt,
            // Not a secret (unlike apiKey, never returned here) — safe to
            // send back so the settings UI can prefill an edit field
            // without requiring the whole credential form to be retyped.
            externalUrl:
              readMaybeEncrypted<ActualConfig>(actualConn.config).externalUrl ??
              null,
          }
        : { connected: false, lastSyncedAt: null, externalUrl: null },
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
          // Never fetched server-side, so it gets no checkOutboundUrl
          // check, only a valid-URL shape check, as any browser-opened link.
          externalUrl: z.string().url().optional().or(z.literal("")),
        }),
      ]),
    )
    .mutation(async ({ ctx, input }) => {
      // Refuses an Actual URL with another scheme than http/https or with a
      // user name or password. Its host, private or not, is trusted as
      // an admin saved it.
      if (input.service === "actual") {
        const safety = checkOutboundUrl(input.serverUrl, "actual");
        if (!safety.ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Refusing to save Actual Budget connection: ${safety.reason}`,
          });
        }
      }

      const config: YnabConfig | ActualConfig =
        input.service === "ynab"
          ? { accessToken: input.accessToken, budgetId: input.budgetId }
          : {
              serverUrl: input.serverUrl,
              apiKey: input.apiKey,
              budgetSyncId: input.budgetSyncId,
              ...(input.externalUrl ? { externalUrl: input.externalUrl } : {}),
            };

      // Encrypt at rest with AES-256-GCM (RULES.md § Permission & Security Gates);
      // readMaybeEncrypted() reads both envelopes and legacy plaintext rows.
      const encryptedConfig = encryptJson(config);

      // onConflictDoUpdate is one atomic statement, so no transaction is needed. The
      // casts below are intentional: the JSONB column stores the encrypted envelope
      // as-is despite its YnabConfig|ActualConfig type; readMaybeEncrypted() decodes it.
      // eslint-disable-next-line no-restricted-syntax -- see block comment above
      const storedConfig = encryptedConfig as unknown as
        YnabConfig | ActualConfig;
      await ctx.db
        .insert(schema.apiConnections)
        .values({ service: input.service, config: storedConfig })
        .onConflictDoUpdate({
          target: schema.apiConnections.service,
          set: { config: storedConfig },
        });

      return { ok: true };
    }),

  /** Update just the Actual connection's External URL (the browser-facing nav link),
   *  without saveConnection's requirement to retype every credential. */
  updateActualExternalUrl: adminProcedure
    .input(
      z.object({ externalUrl: z.string().url().optional().or(z.literal("")) }),
    )
    .mutation(async ({ ctx, input }) => {
      const conn = await getApiConnection(ctx.db, "actual");
      if (!conn)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No Actual Budget connection configured",
        });
      const current = readMaybeEncrypted<ActualConfig>(conn.config);
      const next: ActualConfig = { ...current };
      if (input.externalUrl) next.externalUrl = input.externalUrl;
      else delete next.externalUrl;

      const storedConfig = encryptJson(next);
      // eslint-disable-next-line no-restricted-syntax -- see saveConnection's block comment above
      const storedConfigForDb = storedConfig as unknown as ActualConfig;
      await ctx.db
        .update(schema.apiConnections)
        .set({ config: storedConfigForDb })
        .where(eq(schema.apiConnections.service, "actual"));

      return { ok: true };
    }),

  /** Fetch YNAB budgets list using a raw token (before saving connection) */
  fetchYnabBudgets: adminProcedure
    .input(z.object({ accessToken: z.string().min(1) }))
    .mutation(
      async ({
        input,
      }): Promise<
        ProbeResult<{ budgets: Awaited<ReturnType<typeof listYnabBudgets>> }>
      > => {
        try {
          return {
            ok: true as const,
            budgets: await listYnabBudgets(input.accessToken),
          };
        } catch (e) {
          // The token isn't saved yet, so an auth failure means this token.
          const auth = e instanceof BudgetApiError && e.code === "auth";
          return {
            ok: false as const,
            error: auth
              ? "YNAB didn't accept this access token — check it and try again."
              : (userMessageFor(e) ??
                "Couldn't load your YNAB budgets — try again."),
          };
        }
      },
    ),

  /** Test a specific service connection (works before activation) */
  testConnection: adminProcedure
    .input(z.object({ service: serviceEnum }))
    .mutation(
      async ({ ctx, input }): Promise<ProbeResult<{ budgetName: string }>> => {
        const client = await getClientForService(ctx.db, input.service);
        if (!client) {
          return {
            ok: false,
            error: `No ${input.service} connection configured`,
          };
        }

        try {
          // Actual's budget name is local, so the budget is asked first.
          await client.testConnection();
          const budgetName = await client.getBudgetName();
          return { ok: true, budgetName };
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Unknown error";
          return {
            ok: false,
            error: userMessageFor(e) ?? msg.slice(0, 200),
          };
        }
      },
    ),

  /** Delete a connection and clear its cache */
  deleteConnection: adminProcedure
    .input(z.object({ service: serviceEnum }))
    .mutation(async ({ ctx, input }) => {
      await cacheClear(ctx.db, input.service);
      await ctx.db
        .delete(schema.apiConnections)
        .where(eq(schema.apiConnections.service, input.service));
      // Its pulled debt and loan balances go with it.
      await clearUnmappedPulledBalances(ctx.db);

      // If we're deleting the active API, reset to 'none'
      const active = await getActiveBudgetApi(ctx.db);
      if (active === input.service) {
        await upsertSetting(ctx.db, "active_budget_api", "none");
      }

      return { ok: true };
    }),

  /** Get sync status for the active API */
  getSyncStatus: protectedProcedure.query(async ({ ctx }) => {
    const [active, autoEnabledRow, staleHoursRow] = await Promise.all([
      getActiveBudgetApi(ctx.db),
      ctx.db
        .select({ value: schema.appSettings.value })
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, "sync_auto_enabled"))
        .limit(1)
        .then((r) => r[0]?.value ?? null),
      ctx.db
        .select({ value: schema.appSettings.value })
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, "sync_auto_stale_hours"))
        .limit(1)
        .then((r) => r[0]?.value ?? null),
    ]);

    const parsedStaleHours = Number(staleHoursRow);
    const autoSync = {
      // Off is "false", or false as an earlier PostgreSQL read wrote it back.
      enabled: autoEnabledRow !== "false" && autoEnabledRow !== false,
      staleHours: Math.max(
        1,
        staleHoursRow == null || !Number.isFinite(parsedStaleHours)
          ? 4
          : parsedStaleHours,
      ),
    };

    if (active === "none") {
      return { service: null, connected: false, lastSynced: null, autoSync };
    }

    const conn = await getApiConnection(ctx.db, active);
    return {
      service: active,
      connected: !!conn,
      lastSynced: conn?.lastSyncedAt ?? null,
      autoSync,
    };
  }),
});
