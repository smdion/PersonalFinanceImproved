// Tax Buckets' "At Retirement" view: the "now" breakdown carried to
// computeProjection's retirement transition. In the projection router, so a
// write that invalidates the projection invalidates this view too.
import { z } from "zod/v4";
import {
  createCallerFactory,
  createTRPCRouter,
  internalCtx,
  protectedProcedure,
} from "../../trpc";
import { profileSelectionSchema } from "@/lib/pure/household/profile-selection.schema";
import { taxBucketBreakdown } from "@/server/services/tax/tax-bucket-breakdown";
import { taxBucketsAtRetirement } from "@/server/services/tax/tax-buckets-at-retirement";
import { scenariosRouter } from "./scenarios";

const callScenarios = createCallerFactory(scenariosRouter);

export const taxBucketsAtRetirementRouter = createTRPCRouter({
  /** Tax Buckets' "At Retirement" entries and the inflation it deflates by. */
  computeTaxBucketsAtRetirement: protectedProcedure
    .input(z.strictObject({ selection: profileSelectionSchema.optional() }))
    .query(async ({ ctx, input }) => {
      const [now, run] = await Promise.all([
        taxBucketBreakdown(ctx.db, ctx.scope.asOf),
        callScenarios(internalCtx(ctx)).computeProjection({
          selection: input.selection,
        }),
      ]);
      return {
        projection: taxBucketsAtRetirement(now, run),
        annualInflation:
          "settings" in run ? run.settings.annualInflation : null,
      };
    }),
});
