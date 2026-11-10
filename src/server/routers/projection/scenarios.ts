/**
 * `computeProjection`, the unified contribution/distribution engine endpoint
 * (Coast FIRE lives in `coast-fire.ts`).
 */
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { calculateProjection } from "@/lib/pure/engine";
import {
  hashEngineInput,
  readProjectionCache,
  writeProjectionCache,
} from "@/server/services/projection/projection-cache";
import {
  prepareEngineInput,
  prepareProjectionRun,
} from "@/server/services/projection/projection-run";
import { projectionMetadata } from "@/server/services/projection/projection-metadata";
import {
  accumulationOverrideSchema,
  decumulationOverrideSchema,
  buildCoastFireProfileSwitches,
} from "./_shared";
import { decumulationDefaultsInputSchema } from "@/lib/pure/engine/types";
import { profileSelectionSchema } from "@/lib/pure/household/profile-selection.schema";

export const scenariosRouter = createTRPCRouter({
  /**
   * Unified accumulation + decumulation projection from the same DB sources as the other
   * endpoints, with control over routing mode, tax splits, caps and sticky-forward overrides.
   */
  computeProjection: protectedProcedure
    .input(
      z.strictObject({
        // Accumulation defaults are derived from paycheck/contribution accounts on the server.
        // No client-side accumulation defaults input.

        // --- Decumulation defaults ---
        decumulationDefaults: decumulationDefaultsInputSchema,

        // --- Accumulation overrides ---
        accumulationOverrides: accumulationOverrideSchema,

        // --- Decumulation overrides ---
        decumulationOverrides: decumulationOverrideSchema,

        selection: profileSelectionSchema.optional(),
        /** Optional snapshot ID — use a historical portfolio snapshot instead of the latest. */
        snapshotId: z.number().int().optional(),
        /** Coast FIRE override: zero all contributions from this age, replacing user
         *  accumulation overrides for this query (decumulation overrides are kept). */
        coastFireOverrideAge: z.number().int().min(18).max(120).optional(),
        /** Bypass the projection cache and force a fresh compute — the
         *  explicit "Run Simulation" action, not the default query path. */
        forceRefresh: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { data, payload } = await prepareProjectionRun(ctx, {
        selection: input.selection,
        snapshotId: input.snapshotId,
      });
      if (!payload) return { result: null };
      // No return rate: a state, not an engine throw.
      if (payload.notConfigured)
        return { result: null, notConfigured: payload.notConfigured };

      const { activeContribs, noContribData, portfolioTotal, baseEngineInput } =
        payload;

      // Router-level warnings for silent fallbacks
      const routerWarnings: string[] = [];
      const nullContributionAccounts = activeContribs.filter(
        (c) =>
          c.contributionValue === null || c.contributionValue === undefined, // from a cast stored entry: null is reachable
      );
      if (nullContributionAccounts.length > 0) {
        routerWarnings.push(
          `${nullContributionAccounts.length} contribution account(s) have no contribution value set — defaulting to $0`,
        );
      }
      if (portfolioTotal === 0) {
        routerWarnings.push(
          "No portfolio snapshot available — all starting balances default to $0",
        );
      }

      // With coastFireOverrideAge, add a ProfileSwitch zeroing contributions + match from
      // the coast year, merged with the user's pre-coast switches (buildCoastFireProfileSwitches).
      const profileSwitchesForEngine =
        input.coastFireOverrideAge != null
          ? buildCoastFireProfileSwitches(
              baseEngineInput,
              input.coastFireOverrideAge,
            )
          : baseEngineInput.profileSwitches;

      const engineInput = {
        ...(await prepareEngineInput(ctx.db, payload, input)),
        profileSwitches: profileSwitchesForEngine,
      };
      const inputHash = hashEngineInput("deterministic", engineInput);

      const cached = input.forceRefresh
        ? null
        : await readProjectionCache<ReturnType<typeof calculateProjection>>(
            ctx.db,
            inputHash,
          );
      let result: ReturnType<typeof calculateProjection>;
      if (cached) {
        result = cached.result;
      } else {
        result = calculateProjection(engineInput);
        await writeProjectionCache(ctx.db, inputHash, result, null);
      }

      if (routerWarnings.length > 0) {
        result.warnings.unshift(...routerWarnings);
      }
      if (noContribData) {
        result.warnings.push(
          "No contribution accounts found — projections may be inaccurate. Add contribution accounts on the Paycheck page.",
        );
      }

      return { result, ...projectionMetadata(data, payload) };
    }),
});
