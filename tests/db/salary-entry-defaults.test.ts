import { describe, it, expect } from "vitest";
import { salaryEntrySchema } from "@/lib/db/shapes/json-schemas";
import { BLANK_SALARY_ENTRY } from "@/lib/db/shapes/salary-entry-defaults";

// salaryEntrySchema is `.strict()` and every stored entry is complete, so a
// new required field needs a default here: salaryProfile.getById spreads the
// blank entry under a job's entry, and "+ Add" saves it as is.
describe("BLANK_SALARY_ENTRY — a default for every required field", () => {
  const shape = salaryEntrySchema.shape;
  const required = Object.keys(shape).filter(
    (key) => !shape[key as keyof typeof shape].safeParse(undefined).success,
  );

  it("has exactly the schema's required fields", () => {
    expect(Object.keys(BLANK_SALARY_ENTRY).sort()).toEqual(required.sort());
  });

  it("is itself a valid, complete entry", () => {
    expect(salaryEntrySchema.safeParse(BLANK_SALARY_ENTRY).success).toBe(true);
  });
});
