/**
 * Proof for the strategy behavior fields: each answers as the string checks
 * it replaced (`=== "guyton_klinger"`, `=== "spending_decline"`) for every
 * configured strategy and for stored keys that name none.
 */
import { describe, it, expect } from "vitest";
import { WITHDRAWAL_STRATEGY_VALUES } from "@/lib/config/withdrawal-strategies";
import { storedStrategyConfig } from "@/lib/config/stored-withdrawal-strategy";
import {
  gkAnchorRate,
  strategyAnchorRate,
} from "@/lib/pure/retirement/gk-anchor-rate";

/** Stored keys no configured strategy matches. */
const UNKNOWN = ["", "guardrails", "GUYTON_KLINGER", "toString", "constructor"];
const KEYS = [...WITHDRAWAL_STRATEGY_VALUES, ...UNKNOWN];

/** One accumulation year then two retirement years: an anchor rate of 4%. */
const YEARS = [
  { phase: "accumulation" as const, retirementBalance: 1_000_000 },
  {
    phase: "decumulation" as const,
    retirementBalance: 980_000,
    projectedExpenses: 60_000,
    ssIncome: 20_000,
  },
  {
    phase: "decumulation" as const,
    retirementBalance: 960_000,
    projectedExpenses: 61_000,
    ssIncome: 20_500,
  },
];

function oldReferenceRateNote(strategy: string): string {
  return strategy === "guyton_klinger"
    ? ", adjusted by guardrails"
    : strategy === "spending_decline"
      ? " and its own annual decline schedule"
      : "";
}

describe("strategy behavior fields match the checks they replaced", () => {
  it("the fixture has an anchor rate", () => {
    expect(gkAnchorRate(YEARS)).toBeCloseTo(0.04, 10);
  });

  it.each(KEYS)("strategyAnchorRate(%j)", (key) => {
    expect(strategyAnchorRate(key, YEARS)).toBe(
      key === "guyton_klinger" ? gkAnchorRate(YEARS) : null,
    );
  });

  it("strategyAnchorRate(undefined)", () => {
    expect(strategyAnchorRate(undefined, YEARS)).toBeNull();
  });

  it.each(KEYS)("referenceRateNote for %j", (key) => {
    expect(storedStrategyConfig(key)?.referenceRateNote ?? "").toBe(
      oldReferenceRateNote(key),
    );
  });
});
