/**
 * The chart colours each category and contribution group draws in, pinned to
 * the values the hand-written table held before `chartHex` moved into config.
 */
import { describe, it, expect } from "vitest";
import { categoryChartHex } from "@/lib/utils/colors";

const TODAY: Record<string, [standard: string, roth: string]> = {
  "401k": ["#3b82f6", "#93c5fd"],
  "403b": ["#3b82f6", "#93c5fd"],
  ira: ["#8b5cf6", "#c4b5fd"],
  hsa: ["#10b981", "#6ee7b7"],
  brokerage: ["#f97316", "#fdba74"],
  espp: ["#f59e0b", "#fcd34d"],
  pension: ["#6366f1", "#a5b4fc"],
  unknown: ["#6b7280", "#9ca3af"],
};

describe("categoryChartHex", () => {
  it.each(Object.entries(TODAY))("%s keeps its colours", (key, [std, roth]) => {
    expect(categoryChartHex(key, false)).toBe(std);
    expect(categoryChartHex(key, true)).toBe(roth);
  });
});
