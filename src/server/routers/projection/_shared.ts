/**
 * Shared Zod schemas for the projection router family (monte-carlo,
 * scenarios, strategy, stress-test, presets).
 */

import { decumulationOverrideArraySchema } from "@/lib/pure/engine/types";
import { accumulationOverrideArraySchema } from "@/server/services/projection/projection-run";

export const accumulationOverrideSchema =
  accumulationOverrideArraySchema.optional();
export const decumulationOverrideSchema =
  decumulationOverrideArraySchema.optional();

// Coast FIRE's "stop contributing at age N" lives with the calculator
// (lib/pure/retirement/coast-fire.ts) so the baseline finder and every
// router probe stop contributions the same way.
export { buildCoastFireProfileSwitches } from "@/lib/pure/retirement/coast-fire";
