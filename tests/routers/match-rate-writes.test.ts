/** Every match write stores the rate beside its whole percent through the
 *  real procedures (advisor E8 M11): an edited value moves its rate, leaving
 *  the percent type clears it, and the bound refuses only a raised rate. */
import "./setup-mocks";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestCaller, seedJob, seedPerson } from "./setup";
import * as sqliteSchema from "@/lib/db/schema-sqlite";

type Ctx = Awaited<ReturnType<typeof createTestCaller>>;
let t: Ctx;
let personId: number;
let jobId: number;

beforeEach(async () => {
  t = await createTestCaller();
  personId = await seedPerson(t.db, "Invented Saver", "1985-03-01");
  jobId = seedJob(t.db, personId);
});
afterEach(() => t.cleanup());

const account = {
  accountType: "401k" as const,
  parentCategory: "Retirement" as const,
  taxTreatment: "pre_tax" as const,
  employerMaxMatchPct: "0.06",
};
const row = (id: number) =>
  t.db
    .select()
    .from(sqliteSchema.contributionAccounts)
    .where(eq(sqliteSchema.contributionAccounts.id, id))
    .get()!;
async function percentAccount(value: string) {
  const created = await t.caller.settings.contributionAccounts.create({
    ...account,
    personId,
    jobId,
    employerMatchType: "percent_of_contribution",
    employerMatchValue: value,
  });
  return created!.id;
}
const update = (id: number, fields: Record<string, unknown>) =>
  t.caller.settings.contributionAccounts.update({
    id,
    ...account,
    personId,
    jobId,
    employerMatchType: "percent_of_contribution",
    ...fields,
  });

describe("the account write", () => {
  it("a percent create writes the rate; an edited value moves it", async () => {
    const id = await percentAccount("50");
    expect(row(id)).toMatchObject({
      employerMatchValue: "50",
      employerMatchRate: "0.5",
    });
    await update(id, { employerMatchValue: "60" });
    expect(row(id)).toMatchObject({
      employerMatchValue: "60",
      employerMatchRate: "0.6",
    });
  });

  it("a sent rate sets the value beside it", async () => {
    const id = await percentAccount("50");
    await update(id, { employerMatchValue: "50", employerMatchRate: "0.035" });
    expect(row(id)).toMatchObject({
      employerMatchValue: "3.5",
      employerMatchRate: "0.035",
    });
  });

  it("leaving the percent type clears the rate", async () => {
    const id = await percentAccount("50");
    await update(id, {
      employerMatchType: "dollar_match",
      employerMatchValue: "500",
    });
    expect(row(id)).toMatchObject({
      employerMatchValue: "500",
      employerMatchRate: null,
    });
  });

  it("refuses a rate raised past 200%, and still edits one stored above it", async () => {
    const id = await percentAccount("50");
    await expect(update(id, { employerMatchRate: "50" })).rejects.toThrow(
      /enter 50 for 50%/,
    );
    await expect(update(id, { employerMatchValue: "300" })).rejects.toThrow(
      /200%/,
    );
    t.db
      .update(sqliteSchema.contributionAccounts)
      .set({ employerMatchValue: "300", employerMatchRate: "3" })
      .where(eq(sqliteSchema.contributionAccounts.id, id))
      .run();
    await update(id, { employerMatchValue: "300", notes: "unrelated edit" });
    expect(row(id)).toMatchObject({
      employerMatchRate: "3",
      notes: "unrelated edit",
    });
  });
});

describe("the refusal", () => {
  it("refuses a sent rate with no percent", async () => {
    const id = await percentAccount("50");
    for (const rate of ["1e11", "-1e11", "abc"])
      await expect(update(id, { employerMatchRate: rate })).rejects.toThrow();
    expect(row(id)).toMatchObject({
      employerMatchValue: "50",
      employerMatchRate: "0.5",
    });
  });

  it("refuses a value too large for a rate", async () => {
    const id = await percentAccount("50");
    await expect(
      update(id, { employerMatchValue: "100000000" }),
    ).rejects.toThrow(/200%/);
  });

  it("refuses a new percent finer than two decimals", async () => {
    const id = await percentAccount("50");
    await expect(update(id, { employerMatchValue: "12.345" })).rejects.toThrow(
      /two decimals/,
    );
  });
});
