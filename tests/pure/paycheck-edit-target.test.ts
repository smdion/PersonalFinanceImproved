import { describe, it, expect } from "vitest";
import {
  resolvePaycheckEditTarget,
  type PaycheckEditContext,
} from "@/lib/pure/paycheck-edit-target";
import {
  contributionAccountFieldKind,
  deductionFieldKind,
} from "@/lib/db/profile-fields";

const ctx = (over: Partial<PaycheckEditContext> = {}): PaycheckEditContext => ({
  locked: false,
  canEditProfiles: true,
  canEditSetup: true,
  salaryProfileName: "Sal",
  contributionProfileName: "Con",
  ...over,
});

describe("resolvePaycheckEditTarget", () => {
  it("salary fields save to the active Salary Profile", () => {
    expect(resolvePaycheckEditTarget("salary", ctx())).toEqual({
      target: "salaryProfile",
      label: "Saves to Salary Profile “Sal”",
    });
  });

  it("contribution fields save to the active Contribution Profile", () => {
    expect(resolvePaycheckEditTarget("contribution", ctx()).target).toBe(
      "contributionProfile",
    );
  });

  it("setup saves to the household setup, for those who may edit it", () => {
    expect(resolvePaycheckEditTarget("setup", ctx()).target).toBe("setup");
    expect(
      resolvePaycheckEditTarget("setup", ctx({ canEditSetup: false })).target,
    ).toBe("readOnly");
  });

  it("without profile permission, profile fields are read-only (never a DB write)", () => {
    for (const kind of ["salary", "contribution"] as const)
      expect(
        resolvePaycheckEditTarget(kind, ctx({ canEditProfiles: false })),
      ).toEqual({ target: "readOnly", label: "Needs profile edit permission" });
  });

  it("everything is read-only while locked", () => {
    for (const kind of ["salary", "contribution", "setup"] as const)
      expect(
        resolvePaycheckEditTarget(kind, ctx({ locked: true })).target,
      ).toBe("readOnly");
  });

  it("no active profile of the kind → read-only, saying so", () => {
    expect(
      resolvePaycheckEditTarget("salary", ctx({ salaryProfileName: null }))
        .label,
    ).toBe("No active Salary Profile");
  });
});

describe("profile field kinds come from the profile schemas", () => {
  it("contribution-account fields", () => {
    expect(contributionAccountFieldKind("contributionValue")).toBe(
      "contribution",
    );
    expect(contributionAccountFieldKind("autoMaximize")).toBe("contribution");
    expect(contributionAccountFieldKind("accountType")).toBe("setup");
    expect(contributionAccountFieldKind("performanceAccountId")).toBe("setup");
  });

  it("deduction fields", () => {
    expect(deductionFieldKind("amountPerPeriod")).toBe("contribution");
    expect(deductionFieldKind("deductionName")).toBe("setup");
  });
});
