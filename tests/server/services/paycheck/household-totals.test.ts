/**
 * A withholding table with the Step 2(c) checkbox has no Form 1040
 * analogue: lib/pure says so with its own error, and the paycheck service
 * still answers the client with today's BAD_REQUEST and message.
 */
import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  buildLiabilityBracketInput,
  StandardW4BracketsRequiredError,
} from "@/lib/pure/paycheck/liability-brackets";
import { liabilityBracketInput } from "@/server/services/paycheck/liability-bracket-input";

const MESSAGE =
  "This calculation needs standard W-4 tax brackets (not the multiple-jobs checkbox).";

const table = (w4Checkbox: boolean) => ({
  taxYear: 2026,
  filingStatus: "MFJ" as const,
  w4Checkbox,
  brackets: [
    { threshold: 0, rate: 0 },
    { threshold: 19300, rate: 0.1 },
    { threshold: 44100, rate: 0.12 },
  ],
});
const limits = new Map([
  ["standard_deduction_mfj", 32200],
  ["ss_wage_base", 184500],
  ["fica_ss_rate", 0.062],
  ["fica_medicare_rate", 0.0145],
  ["fica_medicare_surtax_rate", 0.009],
  ["fica_medicare_surtax_threshold", 200000],
]);

describe("liability brackets from a checkbox table", () => {
  it("lib/pure throws its domain error with the message", () => {
    expect(() => buildLiabilityBracketInput(table(true), limits)).toThrow(
      StandardW4BracketsRequiredError,
    );
    expect(() => buildLiabilityBracketInput(table(true), limits)).toThrow(
      MESSAGE,
    );
  });

  it("the service answers BAD_REQUEST with the same message", () => {
    let caught: unknown;
    try {
      liabilityBracketInput(table(true), limits);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe("BAD_REQUEST");
    expect((caught as TRPCError).message).toBe(MESSAGE);
  });

  it("a standard table passes through unchanged", () => {
    expect(liabilityBracketInput(table(false), limits)).toEqual(
      buildLiabilityBracketInput(table(false), limits),
    );
  });
});
