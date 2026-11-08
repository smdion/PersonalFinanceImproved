/** The projection response without the engine run (projection.getProjectionMetadata). */
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { prepareProjectionRun } from "@/server/services/projection/projection-run";
import { projectionMetadata } from "@/server/services/projection/projection-metadata";
import { profileSelectionSchema } from "@/lib/pure/household/profile-selection.schema";

export const projectionMetadataRouter = createTRPCRouter({
  /** computeProjection's response without the engine run (result null):
   *  settings, budgets and the rest. Not configured still returns it. */
  getProjectionMetadata: protectedProcedure
    .input(
      z.strictObject({
        selection: profileSelectionSchema.optional(),
        snapshotId: z.number().int().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { data, payload } = await prepareProjectionRun(ctx, input);
      if (!payload) return { result: null };
      return { result: null, ...projectionMetadata(data, payload) };
    }),
});
