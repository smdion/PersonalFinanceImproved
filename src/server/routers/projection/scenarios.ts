/**
 * Scenario endpoints: unified projection engine.
 *
 * Contains `computeProjection` (the unified contribution/distribution
 * engine). Coast FIRE endpoints (`computeCoastFire`, `computeCoastFireMC`)
 * live in the sibling `coast-fire.ts` file.
 */
import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { calculateProjection } from "@/lib/pure/engine";
import {
  hashEngineInput,
  readProjectionCache,
  writeProjectionCache,
} from "@/server/services/projection/projection-cache";
import { prepareProjectionRun } from "@/server/services/projection/projection-run";
import { projectionMetadata } from "@/server/services/projection/projection-metadata";
import type {
  AccumulationOverride,
  DecumulationOverride,
} from "@/lib/pure/engine/types";
import {
  accumulationOverrideSchema,
  decumulationOverrideSchema,
  buildDecumulationDefaults,
  buildCoastFireProfileSwitches,
  resolveProjectionOverrides,
} from "./_shared";
import { decumulationDefaultsInputSchema } from "@/lib/pure/engine/types";
import { profileSelectionSchema } from "@/lib/pure/household/profile-selection.schema";

export const scenariosRouter = createTRPCRouter({
  /**
   * Contribution/Distribution Engine
   *
   * Unified projection that handles both accumulation and decumulation
   * with full control over routing mode, tax splits, artificial caps,
   * and per-year sticky-forward overrides.
   *
   * All data (salary, contributions, portfolio, limits, return rates)
   * comes from the same DB sources as the other endpoints — this engine
   * just gives you much more granular control over how money is routed.
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
        /** When set, apply a Coast FIRE scenario override: zero all contributions
         *  starting at this age. Replaces user-authored accumulation overrides
         *  for this query — Coast FIRE is a pure "stop contributing" scenario.
         *  Decumulation overrides are preserved. */
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

      const {
        settings,
        activeContribs,
        noContribData,
        distributionTaxRates,
        portfolioTotal,
        baseEngineInput,
      } = payload;

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

      // When coastFireOverrideAge is set, inject a synthetic ProfileSwitch at
      // the coast year that zeros contributions + employer match sticky-
      // forward. Merges with user-authored profileSwitches (preserves any
      // pre-coast-year user switches). See buildCoastFireProfileSwitches docs.
      const profileSwitchesForEngine =
        input.coastFireOverrideAge != null
          ? buildCoastFireProfileSwitches(
              baseEngineInput,
              input.coastFireOverrideAge,
            )
          : baseEngineInput.profileSwitches;

      const engineInput = {
        ...baseEngineInput,
        profileSwitches: profileSwitchesForEngine,
        decumulationDefaults: buildDecumulationDefaults(
          settings,
          input.decumulationDefaults,
          distributionTaxRates,
        ),
        // Omitted "Changes by year" = the household's saved rows.
        ...((await resolveProjectionOverrides(ctx.db, input)) as {
          accumulationOverrides: AccumulationOverride[];
          decumulationOverrides: DecumulationOverride[];
        }),
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
