/**
 * Tiingo router — market-data API key management (benchmark price history).
 *
 * Mirrors the SimpleFIN router's permission split: mutations use
 * syncProcedure (same domain as YNAB/Actual/SimpleFIN connection
 * management) since they write shared server-side credentials and call an
 * external API; getStatus uses protectedProcedure and never returns the key.
 */

import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, syncProcedure } from "../trpc";
import {
  getTiingoConnection,
  getTiingoApiKey,
  saveTiingoConnection,
  removeTiingoConnection,
} from "@/lib/tiingo/connection";
import { testApiKey } from "@/lib/tiingo/client";
import { BudgetApiError } from "@/lib/budget-api/errors";

/** Only an auth failure means the key is bad — rate limits, timeouts and 5xx say nothing about the key. */
function describeTiingoError(e: unknown): string {
  const msg = (e instanceof Error ? e.message : "Unknown error").slice(0, 200);
  if (e instanceof BudgetApiError && e.code === "auth") {
    return `Tiingo rejected the API key: ${msg}`;
  }
  return `Couldn't reach Tiingo to verify the key: ${msg}`;
}

export const tiingoRouter = createTRPCRouter({
  /** Validate a key against Tiingo, then store it encrypted. An invalid key is never saved. */
  saveKey: syncProcedure
    .input(z.object({ apiKey: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await testApiKey(input.apiKey);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: describeTiingoError(e),
        });
      }
      await saveTiingoConnection(ctx.db, input.apiKey);
      return { success: true as const };
    }),

  /** Test the stored key and report how far back price history goes. */
  testConnection: syncProcedure.mutation(async ({ ctx }) => {
    try {
      // Inside the try: decrypting can fail (e.g. a restored backup from an
      // instance with a different ENCRYPTION_KEY) — report it, don't 500.
      const apiKey = await getTiingoApiKey(ctx.db);
      if (!apiKey) {
        return {
          success: false as const,
          error: "No Tiingo connection configured",
        };
      }
      const meta = await testApiKey(apiKey);
      return {
        success: true as const,
        ticker: meta.ticker,
        historyStart: meta.startDate,
      };
    } catch (e) {
      return { success: false as const, error: describeTiingoError(e) };
    }
  }),

  /** Remove the stored key. */
  removeConnection: syncProcedure.mutation(async ({ ctx }) => {
    await removeTiingoConnection(ctx.db);
    return { success: true as const };
  }),

  /** Connection status for the Settings integrations card. Never returns the key. */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const conn = await getTiingoConnection(ctx.db);
    return {
      connected: conn !== null,
      lastSyncedAt: conn?.lastSyncedAt ?? null,
    };
  }),
});
