import { MC_CONFIDENCE_THRESHOLD } from "@/lib/constants";

/** Where a Simulation rate (success, spending or budget stability) turns
 *  green (the one Simulation bar), else amber, else red — the dashboard and
 *  the strategy comparison. */
export const SIMULATION_RATE_TONES = {
  green: MC_CONFIDENCE_THRESHOLD,
  amber: 0.75,
} as const;

export function simulationRateTone(rate: number): "green" | "amber" | "red" {
  if (rate >= SIMULATION_RATE_TONES.green) return "green";
  if (rate >= SIMULATION_RATE_TONES.amber) return "amber";
  return "red";
}
