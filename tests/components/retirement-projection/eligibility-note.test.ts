/** The retirement table's per-account eligibility note branches on the
 *  reason's kind (v0.10.3 plan commit 11b); the words are as before. */
import { describe, it, expect } from "vitest";
import { buildEligibilityNote } from "@/components/retirement-projection/account-notes";
import type { IndividualAccountYearBalance } from "@/lib/pure/accounts/account-balances.types";
import type { EligibilityReason } from "@/lib/config/eligibility-reason";

const rothIra = (
  reason: EligibilityReason,
  withdrawal: number,
  eligibilityLocked = false,
): IndividualAccountYearBalance => ({
  name: "Roth IRA",
  category: "ira",
  taxType: "taxFree",
  balance: 20000,
  contribution: 0,
  employerMatch: 0,
  growth: 0,
  draw: { withdrawal, eligibilityLocked, reason },
  roth: { basisRemaining: 9000, basisDrawn: 1000 },
});
const note = (ia: IndividualAccountYearBalance) =>
  buildEligibilityNote(ia, { year: 2040 }, (v) => v);

describe("buildEligibilityNote", () => {
  it("a basis reason: the basis clause is rebuilt from the row's basis", () => {
    expect(
      note(rothIra({ kind: "basis_remaining", basis: 10000 }, 1000)),
    ).toEqual({
      note: "Eligible — $10,000.00 basis remaining, always penalty-free · basis $1,000.00 drawn, $9,000.00 left",
      noteLocked: false,
    });
  });

  it("growth drawn before 59½ is flagged taxable and penalized", () => {
    expect(
      note(rothIra({ kind: "basis_remaining", basis: 10000 }, 1500)).note,
    ).toBe(
      "Partially eligible — $10,000.00 basis remaining, always penalty-free · basis $1,000.00 + growth $500.00, taxable + penalized (under 59½) drawn, $9,000.00 basis left",
    );
  });

  it("age 59½ reached: growth is not flagged", () => {
    expect(
      note(rothIra({ kind: "age_reached", gate: "age_59_half" }, 1500)).note,
    ).toBe(
      "Eligible — age 59½ or older · basis $1,000.00 + growth $500.00 drawn, $9,000.00 basis left",
    );
  });

  it("the Rule of 55 lifts the penalty, not the tax: growth is flagged", () => {
    expect(
      note(rothIra({ kind: "rule_of_55", separationYear: 2038 }, 1500)).note,
    ).toBe(
      "Eligible — Rule of 55 met (separated 2038) · basis $1,000.00 + growth $500.00, taxable + penalized (under 59½) drawn, $9,000.00 basis left",
    );
  });

  it("a locked account shows its reason and is marked locked", () => {
    expect(
      note(
        rothIra(
          { kind: "locked", gate: "age_59_half", currentAge: 52 },
          0,
          true,
        ),
      ),
    ).toEqual({
      note: "Locked until age 59½ (currently 52) · basis $1,000.00 drawn, $9,000.00 left",
      noteLocked: true,
    });
  });
});
