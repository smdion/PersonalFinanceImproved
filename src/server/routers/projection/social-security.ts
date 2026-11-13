/**
 * Social Security claiming-age sweep. `pia` comes from the caller (a what-if
 * axis); the birth year is the projection's own, found by `personId` in
 * `perPersonSettings` (an unknown id is a BAD_REQUEST).
 */
import { z } from "zod/v4";
import { zMoneyNumber } from "@/lib/utils/zod-fields";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { sweepClaimingAges } from "@/lib/pure/retirement/social-security";
import type { ProjectionInput } from "@/lib/pure/engine/types";
import {
  prepareEngineInput,
  prepareProjectionRun,
} from "@/server/services/projection/projection-run";
import {
  buildSocialSecurityEntries,
  type SsEntryOverride,
} from "@/lib/pure/retirement/social-security-entries";
import {
  accumulationOverrideSchema,
  decumulationOverrideSchema,
} from "./_shared";
import { decumulationDefaultsInputSchema } from "@/lib/pure/engine/types";
import { profileSelectionSchema } from "@/lib/pure/household/profile-selection.schema";

export const socialSecurityRouter = createTRPCRouter({
  /**
   * Claiming-age sweep for one person on the household's real projection (`sweepClaimingAges`).
   * Omitted `decumulationDefaults` = persisted settings; `selection` = the page's picks. Every
   * candidate uses a PIA-derived benefit, so it isn't comparable for a non-PIA household.
   */
  computeSocialSecurityClaimingSweep: protectedProcedure
    .input(
      z.strictObject({
        personId: z.number().int(),
        pia: zMoneyNumber.positive(),
        ages: z.array(z.number().int().min(62).max(70)).min(1).optional(),
        decumulationDefaults: decumulationDefaultsInputSchema,
        accumulationOverrides: accumulationOverrideSchema,
        decumulationOverrides: decumulationOverrideSchema,
        selection: profileSelectionSchema.optional(),
        snapshotId: z.number().int().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { payload } = await prepareProjectionRun(ctx, {
        selection: input.selection,
        snapshotId: input.snapshotId,
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

      const { perPersonSettings } = payload;
      const engineInput = await prepareEngineInput(ctx.db, payload, input);

      // Multi-person: rebuild every candidate's FULL entries array via the shared helper,
      // since spousal top-ups depend on this person's claiming age. Single-person uses
      // `sweepClaimingAges`'s default scalar-override builder.
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
          dateOfBirth: person.dateOfBirth,
          ages: input.ages,
          buildCandidateInput,
        }),
      };
    }),
});
