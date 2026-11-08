/**
 * Tiingo router — market-data API key management (benchmark price history).
 *
 * Mirrors the SimpleFIN router's permission split: mutations use
 * syncProcedure (same domain as SimpleFIN connection management) since
 * they write shared server-side credentials and call an
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
import type { ProbeResult } from "@/lib/http/probe-result";
import {
  BudgetApiError,
  externalErrorSentence,
  nothingChanged,
  userMessageFor,
} from "@/lib/budget-api/errors";

/** Only an auth failure means the key is bad — rate limits, timeouts and 5xx say nothing about the key. */
function describeTiingoError(e: unknown): string {
  const msg = (e instanceof Error ? e.message : "Unknown error").slice(0, 200);
  if (e instanceof BudgetApiError && e.code === "auth") {
    return `Tiingo rejected the API key: ${msg}`;
  }
  if (e instanceof BudgetApiError && e.code === "bad-response")
    return externalErrorSentence(e);
  return `Couldn't reach Tiingo to verify the key: ${msg}`;
}

const KEY_UNREADABLE =
  "The saved Tiingo key can't be decrypted (it was saved with a different ENCRYPTION_KEY) — enter the key again.";

export const tiingoRouter = createTRPCRouter({
  /** Validate a key against Tiingo, then store it encrypted. An invalid key is never saved. */
  saveKey: syncProcedure
    .input(z.object({ apiKey: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await testApiKey(input.apiKey);
      } catch (e) {
        // Nothing is stored until Tiingo accepts the key.
        const cause = e instanceof BudgetApiError ? nothingChanged(e) : e;
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: userMessageFor(cause) ?? describeTiingoError(e),
          cause,
        });
      }
      await saveTiingoConnection(ctx.db, input.apiKey);
      return { ok: true as const };
    }),

  /** Test the stored key and report how far back price history goes. */
  testConnection: syncProcedure.mutation(
    async ({
      ctx,
    }): Promise<
      ProbeResult<{ ticker: string; historyStart: string | null }>
    > => {
      let apiKey: string | null;
      try {
        apiKey = await getTiingoApiKey(ctx.db);
      } catch {
        // A key saved under another ENCRYPTION_KEY (e.g. a restored backup).
        return { success: false as const, error: KEY_UNREADABLE };
      }
      if (!apiKey) {
        return {
          success: false as const,
          error: "No Tiingo connection configured",
        };
      }
      try {
        const meta = await testApiKey(apiKey);
        return {
          success: true as const,
          ticker: meta.ticker,
          historyStart: meta.startDate,
        };
      } catch (e) {
        return { success: false as const, error: describeTiingoError(e) };
      }
    },
  ),

  /** Remove the stored key. */
  removeConnection: syncProcedure.mutation(async ({ ctx }) => {
    await removeTiingoConnection(ctx.db);
    return { ok: true as const };
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
