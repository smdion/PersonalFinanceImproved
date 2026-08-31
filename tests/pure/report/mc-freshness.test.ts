import { describe, it, expect } from "vitest";
import {
  checkReportGate,
  reportGateFailureMessage,
  type ReportGateInput,
} from "@/lib/pure/report/mc-freshness";

function baseInput(overrides: Partial<ReportGateInput> = {}): ReportGateInput {
  const sharedInput = { a: 1 };
  return {
    scenarioView: "baseline",
    mcTaxMode: "advanced",
    sharedInput,
    debouncedInput: sharedInput,
    engineQuery: { isFetching: false, isPlaceholderData: false, data: {} },
    mcQuery: { isFetching: false, data: {} },
    ...overrides,
  };
}

describe("checkReportGate", () => {
  it("passes when every check is satisfied", () => {
    expect(checkReportGate(baseInput())).toEqual({ ok: true });
  });

  it("blocks a non-baseline scenario (Coast FIRE/Rate-Seeded source a different MC result and different deterministic projection than the baseline assumptions echo)", () => {
    const result = checkReportGate(baseInput({ scenarioView: "coastFire" }));
    expect(result).toEqual({ ok: false, failure: "not-baseline-scenario" });
  });

  it("blocks Simple tax mode (no RMDs/Roth conversions/ACA-IRMAA effects modeled at all under Simple)", () => {
    const result = checkReportGate(baseInput({ mcTaxMode: "simple" }));
    expect(result).toEqual({ ok: false, failure: "simple-tax-mode" });
  });

  it("blocks when the live input hasn't caught up with the debounced input yet (edit-then-immediately-print race)", () => {
    const result = checkReportGate(
      baseInput({ sharedInput: { a: 2 }, debouncedInput: { a: 1 } }),
    );
    expect(result).toEqual({ ok: false, failure: "inputs-unsettled" });
  });

  it("blocks while the deterministic engine is fetching", () => {
    const result = checkReportGate(
      baseInput({
        engineQuery: { isFetching: true, isPlaceholderData: false, data: {} },
      }),
    );
    expect(result).toEqual({ ok: false, failure: "engine-not-fresh" });
  });

  it("blocks stale placeholder engine data (engineQuery keeps previous-input data visible during a refetch)", () => {
    const result = checkReportGate(
      baseInput({
        engineQuery: { isFetching: false, isPlaceholderData: true, data: {} },
      }),
    );
    expect(result).toEqual({ ok: false, failure: "engine-not-fresh" });
  });

  it("blocks when the engine has no data at all yet", () => {
    const result = checkReportGate(
      baseInput({
        engineQuery: {
          isFetching: false,
          isPlaceholderData: false,
          data: undefined,
        },
      }),
    );
    expect(result).toEqual({ ok: false, failure: "engine-not-fresh" });
  });

  it("blocks while Monte Carlo is fetching", () => {
    const result = checkReportGate(
      baseInput({ mcQuery: { isFetching: true, data: {} } }),
    );
    expect(result).toEqual({ ok: false, failure: "mc-not-fresh" });
  });

  it("blocks when Monte Carlo has no data yet (never run for this input — mcQuery uses placeholderData: undefined, so this alone is the correct 'not run' signal for it)", () => {
    const result = checkReportGate(
      baseInput({ mcQuery: { isFetching: false, data: undefined } }),
    );
    expect(result).toEqual({ ok: false, failure: "mc-not-fresh" });
  });

  it("checks scenario and tax-mode before the freshness checks (cheap, deterministic conditions first)", () => {
    const result = checkReportGate(
      baseInput({
        scenarioView: "rateSeeded",
        mcTaxMode: "simple",
        mcQuery: { isFetching: true, data: undefined },
      }),
    );
    expect(result.failure).toBe("not-baseline-scenario");
  });
});

describe("reportGateFailureMessage", () => {
  it("never mentions the product name directly (terminology rule — user-facing text must say 'the simulation', not 'Monte Carlo simulation')", () => {
    const failures = [
      "not-baseline-scenario",
      "simple-tax-mode",
      "inputs-unsettled",
      "engine-not-fresh",
      "mc-not-fresh",
    ] as const;
    for (const f of failures) {
      expect(reportGateFailureMessage(f)).not.toMatch(/Monte Carlo/);
    }
  });

  it("returns non-empty, distinct copy for every failure reason", () => {
    const failures = [
      "not-baseline-scenario",
      "simple-tax-mode",
      "inputs-unsettled",
      "engine-not-fresh",
      "mc-not-fresh",
    ] as const;
    const messages = failures.map(reportGateFailureMessage);
    expect(new Set(messages).size).toBe(messages.length);
    for (const m of messages) expect(m.length).toBeGreaterThan(0);
  });
});
