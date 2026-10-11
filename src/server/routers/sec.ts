/**
 * SEC router — the contact for SEC's fair-access policy, and the weekly
 * fund-facts refresh. Same permission split as Tiingo: writes and SEC calls
 * use syncProcedure; getStatus is read-only and never returns the contact.
 */
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { isNotNull } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure, syncProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import {
  getSecConnection,
  getSecContact,
  removeSecConnection,
  saveSecConnection,
} from "@/lib/sec/connection";
import { SecRateLimitError, testSecContact } from "@/lib/sec/client";
import { getSecFactsStatus, syncSecurityFacts } from "@/lib/sec/facts-sync";

const MANUAL_REFRESH_GAP_MS = 10 * 60 * 1000;
let lastManualRefresh = 0;

function describe(e: unknown): string {
  if (e instanceof SecRateLimitError)
    return "SEC declined the request — check the contact email, or try again later.";
  return `Couldn't reach SEC: ${(e instanceof Error ? e.message : "Unknown error").slice(0, 200)}`;
}

export const secRouter = createTRPCRouter({
  /** Check SEC accepts the contact, then store it encrypted. */
  saveContact: syncProcedure
    .input(z.object({ contactEmail: z.email().max(200) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await testSecContact(input.contactEmail);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: describe(e) });
      }
      await saveSecConnection(ctx.db, input.contactEmail);
      return { success: true as const };
    }),

  /** Test the stored contact. */
  testConnection: syncProcedure.mutation(async ({ ctx }) => {
    try {
      const contact = await getSecContact(ctx.db);
      if (!contact)
        return { success: false as const, error: "SEC isn't set up" };
      return { success: true as const, funds: await testSecContact(contact) };
    } catch (e) {
      return { success: false as const, error: describe(e) };
    }
  }),

  /** Check every held fund for new filings now (at most every 10 minutes). */
  refreshNow: syncProcedure.mutation(async ({ ctx }) => {
    if (Date.now() - lastManualRefresh < MANUAL_REFRESH_GAP_MS)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message:
          "Fund facts were refreshed moments ago — try again in a few minutes.",
      });
    lastManualRefresh = Date.now();
    return syncSecurityFacts(ctx.db, { force: true });
  }),

  removeConnection: syncProcedure.mutation(async ({ ctx }) => {
    await removeSecConnection(ctx.db);
    return { success: true as const };
  }),

  /** Status for Settings and Data sources. Never returns the contact. */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const [conn, status, facts, securities] = await Promise.all([
      getSecConnection(ctx.db),
      getSecFactsStatus(ctx.db),
      ctx.db
        .selectDistinct({ id: schema.securityFacts.securityId })
        .from(schema.securityFacts),
      ctx.db
        .select({
          id: schema.securities.id,
          basis: schema.securities.factsBasis,
          confirmed: schema.securities.standinConfirmedAt,
        })
        .from(schema.securities)
        .where(isNotNull(schema.securities.factsCheckedAt)),
    ]);
    const withFacts = new Set(facts.map((f) => f.id));
    return {
      connected: conn !== null,
      lastRun: status.lastRun,
      lastError: status.lastError,
      fundsWithFacts: withFacts.size,
      standInsToConfirm: securities.filter(
        (s) => s.basis === "standin" && s.confirmed === null,
      ).length,
      fundsWithoutSource: securities.filter(
        (s) => s.basis === null && !withFacts.has(s.id),
      ).length,
    };
  }),
});
