/**
 * Write-side validation for the Contribution Profile active-field schemas.
 *
 * `jobActiveFieldsSchema` (the superseded Stage-A design where a
 * Contribution Profile could patch tax-input/schedule fields onto a job)
 * is gone — Stage B deleted the `jobs` active-fields bucket wholesale. Pay
 * schedule, W-4 elections, and bonus pay date/flags all moved to the
 * Salary Profile entry instead (see salaryEntriesSchema in
 * tests/integration/zod-schemas.test.ts). This file now only covers
 * `deductionActiveFieldsSchema` and the two-bucket
 * `contributionActiveFieldsSchema` shape.
 */
import { describe, it, expect } from "vitest";
import {
  deductionActiveFieldsSchema,
  contributionActiveFieldsSchema,
} from "@/lib/db/json-schemas";

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

describe("contributionActiveFieldsSchema — two-bucket shape", () => {
  it("accepts the full contributionAccounts/deductions shape", () => {
    const result = contributionActiveFieldsSchema.safeParse({
      contributionAccounts: {
        "5": { contributionValue: "100", contributionMethod: "fixed_annual" },
      },
      deductions: { "1": { amountPerPeriod: "10" } },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a `jobs` key — the bucket no longer exists (.strict())", () => {
    const result = contributionActiveFieldsSchema.safeParse({
      contributionAccounts: {},
      jobs: { "1": { employerName: "NewCorp" } },
    });
    expect(result.success).toBe(false);
  });

  it("defaults deductions to {} when omitted", () => {
    const result = contributionActiveFieldsSchema.parse({});
    expect(result.deductions).toEqual({});
  });
});
