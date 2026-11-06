/**
 * The two balance tracks (acctBal by category, indBal by account) drifting
 * apart by more than $1 shows as this warning in a projection year.
 */
import { expect } from "vitest";
import type { ProjectionResult } from "@/lib/pure/engine/types";

const DRIFT_WARNING = "[DIAG] indBal/acctBal reconciliation";

/** Every string anywhere in a value (an engine or router result) that is a
 *  drift warning. */
export function driftIn(value: unknown): string[] {
  if (typeof value === "string")
    return value.includes(DRIFT_WARNING) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(driftIn);
  if (value !== null && typeof value === "object")
    return Object.values(value).flatMap(driftIn);
  return [];
}

/** Wraps the engine so every projection a suite runs records its drift
 *  warnings under the running test's name. */
export function recordDrift<I>(run: (input: I) => ProjectionResult) {
  const byTest = new Map<string, string[]>();
  const calculate = (input: I): ProjectionResult => {
    const result = run(input);
    const name = expect.getState().currentTestName ?? "";
    byTest.set(name, [...(byTest.get(name) ?? []), ...driftIn(result)]);
    return result;
  };
  /** The tests whose projections drifted. */
  const drifting = () =>
    [...byTest].filter(([, warnings]) => warnings.length > 0);
  return { calculate, byTest, drifting };
}
