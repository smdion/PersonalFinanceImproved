/**
 * Write-side validation for the Contribution Profile active-field schemas
 * extended by the tax-input/deductions plan: `jobActiveFieldsSchema`'s 5 new
 * tax-input/schedule keys (plus the payPeriod/payWeek/anchorPayDate coupled
 * triplet), and the new `deductionActiveFieldsSchema` bucket.
 */
import { describe, it, expect } from "vitest";
import {
  jobActiveFieldsSchema,
  deductionActiveFieldsSchema,
  contributionActiveFieldsSchema,
} from "@/lib/db/json-schemas";

describe("jobActiveFieldsSchema — tax-input fields", () => {
  it("accepts a valid w4FilingStatus/w4Box2cChecked/additionalFedWithholding combination", () => {
    const result = jobActiveFieldsSchema.safeParse({
      w4FilingStatus: "Single",
      w4Box2cChecked: true,
      additionalFedWithholding: "50.00",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown w4FilingStatus value", () => {
    const result = jobActiveFieldsSchema.safeParse({
      w4FilingStatus: "Married",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed additionalFedWithholding decimal string", () => {
    expect(
      jobActiveFieldsSchema.safeParse({ additionalFedWithholding: "" }).success,
    ).toBe(false);
    expect(
      jobActiveFieldsSchema.safeParse({ additionalFedWithholding: "$50" })
        .success,
    ).toBe(false);
    expect(
      jobActiveFieldsSchema.safeParse({ additionalFedWithholding: "1,200" })
        .success,
    ).toBe(false);
  });

  it("accepts additionalFedWithholding as a numeric-looking string", () => {
    expect(
      jobActiveFieldsSchema.safeParse({ additionalFedWithholding: "0" })
        .success,
    ).toBe(true);
  });

  it("rejects a key not in the allowlist (.strict())", () => {
    const result = jobActiveFieldsSchema.safeParse({
      someRandomField: "nope",
    });
    expect(result.success).toBe(false);
  });
});

describe("jobActiveFieldsSchema — coupled payPeriod/payWeek/anchorPayDate triplet", () => {
  it("accepts all three set together", () => {
    const result = jobActiveFieldsSchema.safeParse({
      payPeriod: "weekly",
      payWeek: "odd",
      anchorPayDate: "2026-01-02",
    });
    expect(result.success).toBe(true);
  });

  it("accepts none of the three set", () => {
    const result = jobActiveFieldsSchema.safeParse({
      w4FilingStatus: "MFJ",
    });
    expect(result.success).toBe(true);
  });

  it("rejects payPeriod set alone, without payWeek/anchorPayDate", () => {
    const result = jobActiveFieldsSchema.safeParse({ payPeriod: "weekly" });
    expect(result.success).toBe(false);
  });

  it("rejects anchorPayDate set alone", () => {
    const result = jobActiveFieldsSchema.safeParse({
      anchorPayDate: "2026-01-02",
    });
    expect(result.success).toBe(false);
  });

  it("rejects two of the three set but not the third", () => {
    const result = jobActiveFieldsSchema.safeParse({
      payPeriod: "weekly",
      payWeek: "odd",
    });
    expect(result.success).toBe(false);
  });
});

describe("deductionActiveFieldsSchema", () => {
  it("accepts amountPerPeriod as a valid decimal string", () => {
    expect(
      deductionActiveFieldsSchema.safeParse({ amountPerPeriod: "125.50" })
        .success,
    ).toBe(true);
  });

  it("accepts an explicit zero amount", () => {
    expect(
      deductionActiveFieldsSchema.safeParse({ amountPerPeriod: "0" }).success,
    ).toBe(true);
  });

  it("accepts an empty object (no override set)", () => {
    expect(deductionActiveFieldsSchema.safeParse({}).success).toBe(true);
  });

  it("rejects a malformed decimal string", () => {
    expect(
      deductionActiveFieldsSchema.safeParse({ amountPerPeriod: "abc" }).success,
    ).toBe(false);
  });

  it("rejects structural fields — only amountPerPeriod is allowed (.strict())", () => {
    expect(
      deductionActiveFieldsSchema.safeParse({ deductionName: "Dental" })
        .success,
    ).toBe(false);
    expect(
      deductionActiveFieldsSchema.safeParse({ isPretax: true }).success,
    ).toBe(false);
  });
});

describe("contributionActiveFieldsSchema — three-bucket shape", () => {
  it("accepts the full contributionAccounts/jobs/deductions shape", () => {
    const result = contributionActiveFieldsSchema.safeParse({
      contributionAccounts: {},
      jobs: {
        "1": {
          w4FilingStatus: "HOH",
          w4Box2cChecked: false,
          additionalFedWithholding: "25",
        },
      },
      deductions: { "1": { amountPerPeriod: "10" } },
    });
    expect(result.success).toBe(true);
  });

  it("defaults deductions to {} when omitted", () => {
    const result = contributionActiveFieldsSchema.parse({});
    expect(result.deductions).toEqual({});
  });
});
