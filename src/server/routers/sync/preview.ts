import { z } from "zod/v4";
import { protectedProcedure } from "../../trpc";
import { computeSyncPreview } from "@/server/services/sync/preview";
import { serviceEnum } from "./_shared";

export const previewProcedures = {
  /**
   * Preview: read cached data for a service and compare against current manual values.
   * Works before activation — shows what will change when the API is activated.
   */
  getPreview: protectedProcedure
    .input(z.object({ service: serviceEnum }))
    .query(({ ctx, input }) => computeSyncPreview(ctx, input)),
};
