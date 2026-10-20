"use client";

import { useScenario } from "@/lib/context/scenario-context";

/**
 * For a page or card that always shows the full projected year: a short
 * note when the header's View is set to something else, so it never looks
 * like the toggle silently didn't work. Null when there's nothing to say.
 */
export function useFullYearNote(): string | null {
  const { viewMode } = useScenario();
  return viewMode === "projected"
    ? null
    : "Shows the full projected year — the View toggle doesn't change this";
}
