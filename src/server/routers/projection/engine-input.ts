/** The engine input a projection procedure runs, from its payload. */

import type {
  AccumulationOverride,
  DecumulationOverride,
} from "@/lib/pure/engine/types";
import type { Db } from "@/lib/db";
import {
  buildDecumulationDefaults,
  resolveProjectionOverrides,
} from "./_shared";

/**
 * The payload's base input with the resolved decumulation defaults and the
 * "Changes by year" (omitted = the household's saved rows), in that order.
 */
export async function prepareEngineInput<Base extends object>(
  db: Db,
  payload: {
    settings: Parameters<typeof buildDecumulationDefaults>[0];
    distributionTaxRates: Parameters<typeof buildDecumulationDefaults>[2];
    baseEngineInput: Base;
  },
  input: Parameters<typeof resolveProjectionOverrides>[1] & {
    decumulationDefaults: Parameters<typeof buildDecumulationDefaults>[1];
  },
) {
  return {
    ...payload.baseEngineInput,
    decumulationDefaults: buildDecumulationDefaults(
      payload.settings,
      input.decumulationDefaults,
      payload.distributionTaxRates,
    ),
    ...((await resolveProjectionOverrides(db, input)) as {
      accumulationOverrides: AccumulationOverride[];
      decumulationOverrides: DecumulationOverride[];
    }),
  };
}
