/**
 * Community tax-data updates (lib/tax-data/sync.ts): whether they're on,
 * the last check, and the review of a waiting update — what it would
 * change, then Apply or Dismiss (admin). Apply re-verifies the stored file
 * and refuses if the figures changed since the admin reviewed them.
 */
import { createHash } from "crypto";
import { z } from "zod/v4";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
  getSessionUserLabel,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/server/helpers";
import type { TaxDataFile } from "@/lib/db/reference-reconcile-core";
import {
  applyCommunityTaxData,
  previewCommunityTaxData,
  readTaxDataFile,
} from "@/lib/db/reference-data";
import { verifyTaxDataSignature } from "@/lib/tax-data/signature";
import { validateTaxDataFile } from "@/lib/tax-data/validate";
import { describeTaxDataChanges } from "@/lib/tax-data/describe";
import { getValidCronSecret } from "@/lib/auth/cron";
import {
  checkForTaxDataUpdate,
  lastTaxDataCheck,
  setTaxDataSyncEnabled,
  taxDataSyncOffReason,
} from "@/lib/tax-data/sync";

/** The waiting update (the newest pending one above everything this
 *  install has applied or ships), or null. */
export async function pendingUpdate(db: Db) {
  const shipped = readTaxDataFile().dataVersion;
  const rows = await db
    .select()
    .from(schema.taxDataUpdates)
    .orderBy(desc(schema.taxDataUpdates.dataVersion));
  const applied = Math.max(
    shipped,
    ...rows.filter((r) => r.status === "applied").map((r) => r.dataVersion),
  );
  return (
    rows.find((r) => r.status === "pending" && r.dataVersion > applied) ?? null
  );
}

/** The stored file, verified and checked again. */
function verifiedFile(row: { fileText: string; signature: string }) {
  if (!verifyTaxDataSignature(row.fileText, row.signature))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The stored update no longer verifies — it can't be applied.",
    });
  const file = JSON.parse(row.fileText) as TaxDataFile;
  const problems = validateTaxDataFile(file, {
    unknownKeys: "ignore",
    citations: "lenient",
  });
  if (problems.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `The update fails its checks: ${problems[0]}`,
    });
  return file;
}

const diffHash = (changes: unknown) =>
  createHash("sha256").update(JSON.stringify(changes)).digest("hex");

/** One "Check now" a minute, across the install. */
let lastManualCheck = 0;

export const taxDataSyncProcedures = {
  taxDataSync: createTRPCRouter({
    /** On/off, the last check, and a summary of any waiting update. */
    status: protectedProcedure.query(async ({ ctx }) => {
      const off = await taxDataSyncOffReason(ctx.db);
      const pending = await pendingUpdate(ctx.db);
      return {
        enabled: off === null,
        offReason: off,
        cronConfigured: !!getValidCronSecret(),
        lastCheck: await lastTaxDataCheck(ctx.db),
        pending: pending
          ? {
              dataVersion: pending.dataVersion,
              fetchedAt: pending.fetchedAt,
            }
          : null,
      };
    }),

    /** What the waiting update would change, and a hash to approve it by. */
    preview: protectedProcedure.query(async ({ ctx }) => {
      const pending = await pendingUpdate(ctx.db);
      if (!pending) return null;
      const file = verifiedFile(pending);
      const changes = await previewCommunityTaxData(ctx.db, file);
      return {
        dataVersion: pending.dataVersion,
        years: Object.keys(file.years).map(Number),
        diffHash: diffHash(changes),
        changes: describeTaxDataChanges(changes, file),
      };
    }),

    setEnabled: adminProcedure
      .input(z.object({ enabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        await setTaxDataSyncEnabled(ctx.db, input.enabled);
      }),

    checkNow: adminProcedure.mutation(async ({ ctx }) => {
      if (Date.now() - lastManualCheck < 60_000)
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Checked less than a minute ago — try again shortly.",
        });
      lastManualCheck = Date.now();
      return checkForTaxDataUpdate(ctx.db, { force: true });
    }),

    /** Apply the reviewed update, exactly as reviewed. */
    approve: adminProcedure
      .input(z.object({ dataVersion: z.number().int(), diffHash: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const pending = await pendingUpdate(ctx.db);
        if (!pending || pending.dataVersion !== input.dataVersion)
          throw new TRPCError({
            code: "CONFLICT",
            message: "That update is no longer waiting — refresh the page.",
          });
        const file = verifiedFile(pending);
        const before = await previewCommunityTaxData(ctx.db, file);
        if (diffHash(before) !== input.diffHash)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "The figures changed since you reviewed them — review the update again.",
          });
        const changes = await applyCommunityTaxData(ctx.db, file);
        await ctx.db
          .update(schema.taxDataUpdates)
          .set({
            status: "applied",
            decidedBy: getSessionUserLabel(ctx.session),
            decidedAt: new Date(),
          })
          .where(
            and(
              eq(schema.taxDataUpdates.dataVersion, pending.dataVersion),
              eq(schema.taxDataUpdates.status, "pending"),
            ),
          );
        return { changed: changes.length };
      }),

    dismiss: adminProcedure
      .input(z.object({ dataVersion: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .update(schema.taxDataUpdates)
          .set({
            status: "dismissed",
            decidedBy: getSessionUserLabel(ctx.session),
            decidedAt: new Date(),
          })
          .where(
            and(
              eq(schema.taxDataUpdates.dataVersion, input.dataVersion),
              eq(schema.taxDataUpdates.status, "pending"),
            ),
          );
      }),
  }),
};
