/**
 * Social Security claiming-age sweep — router endpoint.
 *
 * Modeled directly on `withdrawal-bracket-optimizer.ts`/`coast-fire.ts`
 * (same `fetchRetirementData`/`buildEnginePayload` input shape,
 * `protectedProcedure.query`, no server-side cache). Split into its own
 * file rather than added to `retirement.ts` for the same CONTRIBUTING.md § Composed Router Convention
 * Composed Router size reason.
 *
 * `pia` is caller-supplied (a real what-if axis the client already has
 * from `perPersonSettings`) — `birthYear` is NOT, despite an earlier
 * version accepting it from the client too: birthYear is authoritative DB
 * data (`perPersonSettings[].birthYear`), and accepting a client-supplied
 * copy would create two independent sources of truth for FRA that could
 * silently disagree with what `build-engine-payload.ts` actually used for
 * this household's real projection. Resolved server-side from
 * `payload.perPersonSettings` by `personId` instead, which also lets this
 * endpoint validate `personId` against the real household (a stale/wrong
 * id is a `BAD_REQUEST`, not a silent no-op or a 500).
 */
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { sweepClaimingAges } from "@/lib/pure/retirement/social-security";
import type {
  AccumulationOverride,
  DecumulationOverride,
  ProjectionInput,
} from "@/lib/pure/engine/types";
import {
  fetchRetirementData,
  buildEnginePayload,
} from "@/server/retirement/build-engine-payload";
import {
  buildSocialSecurityEntries,
  type SsEntryOverride,
} from "@/server/retirement/social-security-entries";
import {
  accumulationOverrideSchema,
  decumulationOverrideSchema,
  buildDecumulationDefaults,
  resolveProjectionOverrides,
} from "./_shared";
import { decumulationDefaultsInputSchema } from "@/lib/pure/engine/types";
import { engineProfileOptions } from "@/lib/pure/household/profile-selection";
import { profileSelectionSchema } from "@/lib/pure/household/profile-selection.schema";

export const socialSecurityRouter = createTRPCRouter({
  /**
   * Claiming-age sweep for one person: runs the household's real
   * projection at each candidate claiming age (default 62-70) and ranks
   * by final net worth, excluding any candidate that depletes the
   * portfolio. See `sweepClaimingAges` for the full algorithm — this
   * endpoint only resolves the household's real `ProjectionInput` and
   * passes the caller's `pia` through.
   *
   * `decumulationDefaults` follows the same optional-with-DB-fallback
   * pattern every other projection endpoint uses (see
   * `decumulationDefaultsInputSchema`'s own docblock) — a caller that
   * omits it gets the household's own persisted withdrawal settings.
   * `selection` carries the page's profile and budget picks: Social
   * Security data lives per Retirement Profile, and depletion excludes a
   * candidate age, so the picks can change which age is recommended.
   *
   * NOTE for step 7 (UI): for a household that has NOT opted into PIA for
   * this person, every candidate this sweep returns still replaces their
   * real flat `socialSecurityMonthly` benefit with a PIA-derived one
   * (`sweepClaimingAges` unconditionally overrides the scalar SS fields
   * per candidate) — the UI must not present these candidates as directly
   * comparable to the household's actual on-screen projection unless
   * they've opted in.
   */
  sweepSocialSecurityClaimingAges: protectedProcedure
    .input(
      z.strictObject({
        personId: z.number().int(),
        pia: z.number().positive(),
        ages: z.array(z.number().int().min(62).max(70)).min(1).optional(),
        decumulationDefaults: decumulationDefaultsInputSchema,
        accumulationOverrides: accumulationOverrideSchema,
        decumulationOverrides: decumulationOverrideSchema,
        selection: profileSelectionSchema.optional(),
        snapshotId: z.number().int().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const profiles = engineProfileOptions(input.selection);
      const data = await fetchRetirementData(ctx.db, {
        snapshotId: input.snapshotId,
        contributionProfileId: profiles.contributionProfileId,
        salaryProfileId: profiles.salaryProfileId,
      });
      const payload = await buildEnginePayload(ctx.db, data, {
        ...profiles,
      });
      if (!payload) return { result: null };
      if (payload.notConfigured)
        return { result: null, notConfigured: payload.notConfigured };

      const person = payload.perPersonSettings.find(
        (p) => p.personId === input.personId,
      );
      if (!person) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `No person with id ${input.personId} in this household's active profile.`,
        });
      }

      const {
        settings,
        distributionTaxRates,
        baseEngineInput,
        perPersonSettings,
      } = payload;
      const engineInput = {
        ...baseEngineInput,
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

      // Multi-person households need every candidate's FULL entries array
      // rebuilt through the shared helper, not just this person's own
      // entry patched in place — a spouse's spousal top-up depends on this
      // person's claiming age (and, symmetrically, this person's own
      // amount can depend on the spouse's stored data). The single-person
      // path stays on `sweepClaimingAges`'s default scalar-override
      // builder, which is already correct (no spousal math is possible
      // with one person).
      const buildCandidateInput =
        perPersonSettings.length > 1
          ? (claimingAge: number): ProjectionInput => {
              const overrides = new Map<number, SsEntryOverride>([
                [person.personId, { pia: input.pia, startAge: claimingAge }],
              ]);
              return {
                ...engineInput,
                socialSecurityEntries: buildSocialSecurityEntries(
                  perPersonSettings,
                  payload.filingStatus,
                  0,
                  overrides,
                ),
              };
            }
          : undefined;

      return {
        result: sweepClaimingAges({
          input: engineInput,
          personId: person.personId,
          pia: input.pia,
          birthYear: person.birthYear,
          ages: input.ages,
          buildCandidateInput,
        }),
      };
    }),
});
