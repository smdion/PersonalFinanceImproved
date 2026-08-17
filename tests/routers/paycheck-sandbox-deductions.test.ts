/**
 * paycheck.computeSummary honors the What-If tab's sandbox deduction edits
 * and additions.
 *
 * - `sandboxDeductionEdits`: overrides an EXISTING deduction's per-period
 *   amount, applied at the same point every other deduction goes through
 *   `calculatePaycheck` — not a second pass after the fact.
 * - `sandboxDeductionAdditions`: appends a hypothetical, personId-keyed
 *   deduction with no DB row, scoped to the requesting person only.
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

describe("paycheck.computeSummary — sandboxDeductionEdits", () => {
  it("overrides an existing deduction's amount", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(db, "Edited");
      const jobId = seedJob(db, personId, { annualSalary: String(SALARY) });
      const deductionId = db
        .insert(sqliteSchema.paycheckDeductions)
        .values({
          jobId,
          deductionName: "Health Insurance",
          amountPerPeriod: "100",
          isPretax: true,
          ficaExempt: false,
        })
        .returning({ id: sqliteSchema.paycheckDeductions.id })
        .get().id;

      const baseline = await caller.paycheck.computeSummary();
      const basePerson = baseline.people.find((p) => p.person.id === personId)!;
      const baselinePreTax = basePerson.paycheck!.preTaxDeductions.reduce(
        (s: number, d: { amount: number }) => s + d.amount,
        0,
      );
      expect(baselinePreTax).toBeCloseTo(100, 2);

      const edited = await caller.paycheck.computeSummary({
        sandboxDeductionEdits: [{ id: deductionId, amountPerPeriod: 250 }],
      });
      const editedPerson = edited.people.find((p) => p.person.id === personId)!;
      const editedPreTax = editedPerson.paycheck!.preTaxDeductions.reduce(
        (s: number, d: { amount: number }) => s + d.amount,
        0,
      );
      expect(editedPreTax).toBeCloseTo(250, 2);
      // Net pay must actually move — proves it went through calculatePaycheck,
      // not a cosmetic-only change.
      expect(editedPerson.paycheck!.netPay).not.toBeCloseTo(
        basePerson.paycheck!.netPay,
        2,
      );
    } finally {
      cleanup();
    }
  });
});

describe("paycheck.computeSummary — sandboxDeductionAdditions", () => {
  it("appends a hypothetical deduction for the matching person only", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const personA = await seedPerson(db, "A");
      const personB = await seedPerson(db, "B");
      seedJob(db, personA, { annualSalary: String(SALARY) });
      seedJob(db, personB, { annualSalary: String(SALARY) });

      const result = await caller.paycheck.computeSummary({
        sandboxDeductionAdditions: [
          {
            personId: personA,
            name: "Life Insurance",
            amountPerPeriod: 40,
            isPretax: false,
          },
        ],
      });

      const a = result.people.find((p) => p.person.id === personA)!;
      const b = result.people.find((p) => p.person.id === personB)!;

      const aPostTax = a.paycheck!.postTaxDeductions.reduce(
        (s: number, d: { amount: number }) => s + d.amount,
        0,
      );
      const bPostTax = b.paycheck!.postTaxDeductions.reduce(
        (s: number, d: { amount: number }) => s + d.amount,
        0,
      );
      expect(aPostTax).toBeCloseTo(40, 2);
      // The addition is personId-scoped — person B must not see it.
      expect(bPostTax).toBeCloseTo(0, 2);
    } finally {
      cleanup();
    }
  });
});
