"use client";

/**
 * The Simulation preset the Retirement page uses — shared by the Simulation
 * and the strategy comparison. Admins save it to the household's settings;
 * anyone else keeps it for this visit (a viewer can't write settings, and
 * switching a view must still work for them).
 */
import { useCallback, useSyncExternalStore } from "react";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { SK_SIMULATION_PRESET } from "@/lib/constants/settings-keys";
import { DEFAULT_SIMULATION, type SimulationPresetKey } from "@/lib/constants";

let viewerChoice: SimulationPresetKey | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useSimulationPreset(): [
  SimulationPresetKey,
  (preset: SimulationPresetKey) => void,
] {
  const canSave = isAdmin(useUser());
  const [saved, setSaved] = usePersistedSetting<SimulationPresetKey>(
    SK_SIMULATION_PRESET,
    DEFAULT_SIMULATION.preset,
  );
  const choice = useSyncExternalStore(
    subscribe,
    () => viewerChoice,
    () => null,
  );
  const setPreset = useCallback(
    (preset: SimulationPresetKey) => {
      if (canSave) return setSaved(preset);
      viewerChoice = preset;
      listeners.forEach((l) => l());
    },
    [canSave, setSaved],
  );
  return [(canSave ? null : choice) ?? saved, setPreset];
}
