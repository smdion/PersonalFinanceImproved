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
import * as schema from "@/lib/db/schema";
import type { GlidePathEntry } from "@/lib/calculators/random";
import {
  MC_RETURN_CLAMP_MAX,
  MC_RETURN_CLAMP_MIN,
  type SimulationPresetKey,
} from "@/lib/constants";
import { glidePathFromRows } from "@/lib/pure/stock-share";
import { toNumber, type Db } from "./transforms";

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
  const p = schema.mcPresets;
  const [presetRow, customRows, savedRow] = await Promise.all([
    isCustom
      ? Promise.resolve(undefined)
      : db
          .select()
          .from(p)
          .where(eq(p.key, key))
          .then((r) => r[0]),
    db.select().from(schema.glidePathAllocations),
    db
      .select({ value: schema.appSettings.value })
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, "mc_asset_class_overrides"))
      .then((r) => r[0] ?? null),
  ]);
  const [presetGlide, presetReturns] = presetRow
    ? await Promise.all([
        db
          .select()
          .from(schema.mcPresetGlidePaths)
          .where(eq(schema.mcPresetGlidePaths.presetId, presetRow.id)),
        db
          .select()
          .from(schema.mcPresetReturnOverrides)
          .where(eq(schema.mcPresetReturnOverrides.presetId, presetRow.id)),
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
      : MC_RETURN_CLAMP_MIN,
    returnClampMax: presetRow
      ? toNumber(presetRow.returnClampMax)
      : MC_RETURN_CLAMP_MAX,
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
