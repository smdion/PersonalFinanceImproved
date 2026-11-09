/**
 * What a Simulation preset means — one definition for every reader: the
 * Simulation, Coast FIRE, the strategy comparison and analyzer, the
 * projection's stock share and the glide-path warning.
 *
 * A named preset (Aggressive, Default, Conservative) sets the returns
 * (its per-class return overrides, else the class's return × its
 * multiplier), the volatility, the glide path, the inflation spread and the
 * return clamps. Custom is the household's own table values, unadjusted,
 * with `glide_path_allocations` as its glide path. A named preset with no
 * glide path of its own falls back to that table.
 *
 * The household's saved asset-class changes (`mc_asset_class_overrides`)
 * apply on top of any preset.
 */
import { eq } from "drizzle-orm";
import { SK_SIMULATION_CUSTOM_CLAMP_BOUNDS } from "@/lib/constants/settings-keys";
import * as schema from "@/lib/db/schema";
import type { GlidePathEntry } from "@/lib/pure/simulation/random";
import {
  SIMULATION_RETURN_CLAMP_MAX,
  SIMULATION_RETURN_CLAMP_MIN,
  type SimulationPresetKey,
} from "@/lib/constants";
import { glidePathFromRows } from "@/lib/pure/simulation/stock-share";
import { toNumber } from "@/lib/utils/numbers";
import type { Db } from "@/lib/db";
import { firstRow } from "@/lib/utils/first-row";

type CustomClampBounds = { returnClampMin: number; returnClampMax: number };
type AssetClassOverride = { id: number; meanReturn?: number; stdDev?: number };

export type SimulationPreset = {
  key: SimulationPresetKey;
  isCustom: boolean;
  /** Custom always; a named preset only when its row exists. */
  found: boolean;
  label: string;
  description: string | null;
  returnMultiplier: number;
  volMultiplier: number;
  inflationStdDev: number | null;
  returnClampMin: number;
  returnClampMax: number;
  glidePath: GlidePathEntry[];
  returnOverrides: ReadonlyMap<number, number>;
  savedAssetOverrides: AssetClassOverride[];
};

export async function loadSimulationPreset(
  db: Db,
  key: SimulationPresetKey,
): Promise<SimulationPreset> {
  const isCustom = key === "custom";
  const p = schema.simulationPresets;
  const [presetRow, customRows, savedRow, customClamps] = await Promise.all([
    isCustom
      ? Promise.resolve(undefined)
      : db.select().from(p).where(eq(p.key, key)).then(firstRow),
    db.select().from(schema.glidePathAllocations),
    db
      .select({ value: schema.appSettings.value })
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, "mc_asset_class_overrides"))
      .then((r) => r[0] ?? null),
    // Custom has no preset row: its bounds are a setting.
    isCustom
      ? db
          .select({ value: schema.appSettings.value })
          .from(schema.appSettings)
          .where(eq(schema.appSettings.key, SK_SIMULATION_CUSTOM_CLAMP_BOUNDS))
          .then((r) => r[0]?.value as CustomClampBounds | undefined)
      : Promise.resolve(undefined),
  ]);
  const [presetGlide, presetReturns] = presetRow
    ? await Promise.all([
        db
          .select()
          .from(schema.simulationPresetGlidePaths)
          .where(eq(schema.simulationPresetGlidePaths.presetId, presetRow.id)),
        db
          .select()
          .from(schema.simulationPresetReturnOverrides)
          .where(
            eq(schema.simulationPresetReturnOverrides.presetId, presetRow.id),
          ),
      ])
    : [[], []];
  return {
    key,
    isCustom,
    found: isCustom || presetRow !== undefined,
    label: presetRow?.label ?? "Custom",
    description: presetRow?.description ?? null,
    returnMultiplier: presetRow ? toNumber(presetRow.returnMultiplier) : 1,
    volMultiplier: presetRow ? toNumber(presetRow.volMultiplier) : 1,
    inflationStdDev: presetRow ? toNumber(presetRow.inflationStdDev) : null,
    returnClampMin: presetRow
      ? toNumber(presetRow.returnClampMin)
      : (customClamps?.returnClampMin ?? SIMULATION_RETURN_CLAMP_MIN),
    returnClampMax: presetRow
      ? toNumber(presetRow.returnClampMax)
      : (customClamps?.returnClampMax ?? SIMULATION_RETURN_CLAMP_MAX),
    glidePath: glidePathFromRows(
      presetGlide.length > 0 ? presetGlide : customRows,
    ),
    returnOverrides: new Map(
      presetReturns.map((r) => [r.assetClassId, toNumber(r.meanReturn)]),
    ),
    savedAssetOverrides: (savedRow?.value ?? []) as AssetClassOverride[],
  };
}

/**
 * The asset classes under a preset. Precedence: `overrides` (a run's own,
 * then the saved ones) > preset return overrides > preset multiplier >
 * table values. A class missing from a preset's return overrides takes the
 * multiplier (0.5 when the preset's multiplier is zero).
 */
export function presetAssetClasses<
  T extends { id: number; name: string; meanReturn: number; stdDev: number },
>(
  base: readonly T[],
  preset: SimulationPreset,
  runOverrides: readonly AssetClassOverride[] = [],
) {
  const byId = new Map(preset.savedAssetOverrides.map((o) => [o.id, o]));
  for (const o of runOverrides) byId.set(o.id, o);
  const hasReturnOverrides = preset.returnOverrides.size > 0;
  return base.map((ac) => {
    const own = byId.get(ac.id);
    return {
      id: ac.id,
      name: ac.name,
      meanReturn:
        own?.meanReturn ??
        (hasReturnOverrides
          ? (preset.returnOverrides.get(ac.id) ??
            ac.meanReturn * (preset.returnMultiplier || 0.5))
          : preset.isCustom
            ? ac.meanReturn
            : ac.meanReturn * preset.returnMultiplier),
      stdDev:
        own?.stdDev ??
        (preset.isCustom ? ac.stdDev : ac.stdDev * preset.volMultiplier),
    };
  });
}
