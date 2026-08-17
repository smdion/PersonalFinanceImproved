/**
 * paycheck.computeSummary / contribution.computeSummary / budget
 * .computeActiveSummary all honor the What-If tab's sandboxContribOverrides
 * — one more layer on top of the picked Contribution Profile's own
 * overrides, applied via the SAME applyContribOverrides merge every other
 * override already goes through.
 */
import "./setup-mocks";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

import { createTestCaller, adminSession, seedPerson, seedJob } from "./setup";
import * as sqliteSchema from "@/lib/db/schema-sqlite";

const SALARY = 120000;

async function seedContribAccount(
  db: Awaited<ReturnType<typeof createTestCaller>>["db"],
  personId: number,
  overrides: Record<string, unknown> = {},
) {
  return db
    .insert(sqliteSchema.contributionAccounts)
    .values({
      personId,
      jobId: null,
      accountType: "401k",
      parentCategory: "Retirement",
      taxTreatment: "pre_tax",
      contributionMethod: "dollar_amount",
      contributionValue: "100",
      employerMatchType: "none",
      isActive: true,
      ownership: "individual",
      ...overrides,
    })
    .returning({ id: sqliteSchema.contributionAccounts.id })
    .get();
}

describe("sandboxContribOverrides", () => {
  it("contribution.computeSummary uses the edited contribution value", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "Edited");
      seedJob(db, personId, { annualSalary: String(SALARY) });
      const contrib = await seedContribAccount(db, personId, {
        contributionValue: "100",
      });

      const baseline = await caller.contribution.computeSummary();
      const basePerContrib = baseline.people
        .find((p) => p.person.id === personId)!
        .perContribData.find((c) => c.contribId === contrib.id)!;
      expect(basePerContrib.annualAmount).toBeCloseTo(100, 2);

      const edited = await caller.contribution.computeSummary({
        sandboxContribOverrides: {
          [String(contrib.id)]: { contributionValue: "500" },
        },
      });
      const editedPerContrib = edited.people
        .find((p) => p.person.id === personId)!
        .perContribData.find((c) => c.contribId === contrib.id)!;
      expect(editedPerContrib.annualAmount).toBeCloseTo(500, 2);
    } finally {
      cleanup();
    }
  });

  it("paycheck.computeSummary reflects the edited contribution in pre-tax deductions", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "Edited");
      const jobId = seedJob(db, personId, { annualSalary: String(SALARY) });
      const contrib = await seedContribAccount(db, personId, {
        jobId,
        contributionMethod: "percent_of_salary",
        // percent_of_salary stores the raw percent number (5 = 5%), not a
        // fraction — see computeAnnualContribution's `value / 100`.
        contributionValue: "5",
        personId: null,
      });

      const baseline = await caller.paycheck.computeSummary();
      const basePerson = baseline.people.find((p) => p.person.id === personId)!;
      const baselinePreTax = basePerson.paycheck!.preTaxDeductions.reduce(
        (s: number, d: { amount: number }) => s + d.amount,
        0,
      );

      const edited = await caller.paycheck.computeSummary({
        sandboxContribOverrides: {
          [String(contrib.id)]: { contributionValue: "20" },
        },
      });
      const editedPerson = edited.people.find((p) => p.person.id === personId)!;
      const editedPreTax = editedPerson.paycheck!.preTaxDeductions.reduce(
        (s: number, d: { amount: number }) => s + d.amount,
        0,
      );

      expect(editedPreTax).toBeGreaterThan(baselinePreTax);
    } finally {
      cleanup();
    }
  });
});

describe("sandboxContribAdditions", () => {
  it("adds a hypothetical contribution account for the matching person only", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personA = await seedPerson(db, "A");
      const personB = await seedPerson(db, "B");
      seedJob(db, personA, { annualSalary: String(SALARY) });
      seedJob(db, personB, { annualSalary: String(SALARY) });

      const result = await caller.contribution.computeSummary({
        sandboxContribAdditions: [
          {
            personId: personA,
            accountType: "ira",
            contributionMethod: "fixed_annual",
            contributionValue: "500",
          },
        ],
      });

      const a = result.people.find((p) => p.person.id === personA)!;
      const b = result.people.find((p) => p.person.id === personB)!;

      expect(
        a.perContribData.some((c) => c.contribId < 0 && c.annualAmount > 0),
      ).toBe(true);
      expect(b.perContribData.some((c) => c.contribId < 0)).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("a hypothetical addition defaults to personal (jobId: null), so it does NOT touch paycheck-level net pay", async () => {
    // buildSandboxContribRow deliberately doesn't attach the addition to a
    // job — a brand-new account isn't automatically payroll-linked (same as
    // a real freshly-created account with no jobId). Only job-linked
    // contributions are payroll-deducted and move net pay; this addition
    // should show up in contribution.computeSummary's totals (see the test
    // above) without silently changing the pay stub too.
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "Added");
      seedJob(db, personId, { annualSalary: String(SALARY) });

      const baseline = await caller.paycheck.computeSummary();
      const basePerson = baseline.people.find((p) => p.person.id === personId)!;

      const withAddition = await caller.paycheck.computeSummary({
        sandboxContribAdditions: [
          {
            personId,
            accountType: "401k",
            contributionMethod: "percent_of_salary",
            contributionValue: "10",
          },
        ],
      });
      const addedPerson = withAddition.people.find(
        (p) => p.person.id === personId,
      )!;

      expect(addedPerson.paycheck!.netPay).toBeCloseTo(
        basePerson.paycheck!.netPay,
        2,
      );
    } finally {
      cleanup();
    }
  });
});
