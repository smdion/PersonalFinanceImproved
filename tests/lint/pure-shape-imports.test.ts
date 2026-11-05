/**
 * RULES § Pure Business Logic Boundary: pure code may read lib/db's shape
 * files (types and zod schemas, the layer manifest's `shapes`), and nothing
 * else in lib/db.
 */
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint();
const restricted = async (source: string) => {
  const [result] = await eslint.lintText(source, {
    filePath: "src/lib/pure/household/probe.ts",
  });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === "no-restricted-imports")
    .map((m) => m.line);
};

describe("pure code and lib/db", () => {
  it("may import the four shape files", async () => {
    const source = [
      'import { salaryEntrySchema } from "@/lib/db/json-schemas";',
      'import { SALARY_ENTRY_DEFAULTS } from "@/lib/db/salary-entry-defaults";',
      'import { applySalaryEntryEdit } from "@/lib/db/salary-entry-edit";',
      'import { PROFILE_FIELDS } from "@/lib/db/profile-fields";',
      "export const all = [salaryEntrySchema, SALARY_ENTRY_DEFAULTS, applySalaryEntryEdit, PROFILE_FIELDS];",
    ].join("\n");
    expect(await restricted(source)).toEqual([]);
  }, 60_000);

  it("may not import the rest of lib/db or the ORM", async () => {
    const source = [
      'import { db } from "@/lib/db";',
      'import * as schema from "@/lib/db/schema";',
      'import { eq } from "drizzle-orm";',
      "export const all = [db, schema, eq];",
    ].join("\n");
    expect(await restricted(source)).toEqual([1, 2, 3]);
  }, 60_000);
});
