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
const entries = (id: number) =>
  (
    t.db
      .select()
      .from(sqliteSchema.contributionProfiles)
      .where(eq(sqliteSchema.contributionProfiles.id, id))
      .get()!.contributionActiveFields as {
      contributionAccounts: Record<string, Record<string, unknown>>;
    }
  ).contributionAccounts;

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

describe("an account's type change", () => {
  it("moves the rate of every entry that resolves its type from the account", async () => {
    const a = (await t.caller.settings.contributionAccounts.create({
      ...account,
      personId,
      jobId,
      employerMatchType: "dollar_match",
      employerMatchValue: "500",
    }))!.id;
    const p = await t.caller.contributionProfile.create({
      name: "Invented plan",
      contributionActiveFields: {
        contributionAccounts: {
          [a]: {
            contributionValue: "6",
            contributionMethod: "percent_of_salary",
            employerMatchValue: "40",
          },
        },
        deductions: {},
      },
    });
    expect(entries(p.id)[a]).not.toHaveProperty("employerMatchRate");
    await update(a, { employerMatchValue: "50" });
    expect(entries(p.id)[a]).toMatchObject({
      employerMatchValue: "40",
      employerMatchRate: "0.4",
    });
    await update(a, {
      employerMatchType: "fixed_annual",
      employerMatchValue: "1000",
    });
    expect(entries(p.id)[a]).not.toHaveProperty("employerMatchRate");
  });

  it("moves a borrowed rate when the account's value changes", async () => {
    const a = (await t.caller.settings.contributionAccounts.create({
      ...account,
      personId,
      jobId,
      employerMatchType: "dollar_match",
      employerMatchValue: "40",
    }))!.id;
    const p = await t.caller.contributionProfile.create({
      name: "Invented plan",
      contributionActiveFields: {
        contributionAccounts: {
          [a]: {
            contributionValue: "6",
            contributionMethod: "percent_of_salary",
            employerMatchType: "percent_of_contribution",
          },
        },
        deductions: {},
      },
    });
    expect(entries(p.id)[a]).toMatchObject({ employerMatchRate: "0.4" });
    await update(a, {
      employerMatchType: "dollar_match",
      employerMatchValue: "60",
    });
    expect(entries(p.id)[a]).toMatchObject({ employerMatchRate: "0.6" });
    await t.caller.contributionProfile.setAccountActiveFields({
      profileId: p.id,
      accountId: a,
      fields: { isActive: true },
    });
    expect(entries(p.id)[a]).toMatchObject({ employerMatchRate: "0.6" });
  });

  it("refuses a sent rate with no percent, on the account and the entry", async () => {
    const id = await percentAccount("50");
    for (const rate of ["1e11", "-1e11", "abc"])
      await expect(update(id, { employerMatchRate: rate })).rejects.toThrow();
    expect(row(id)).toMatchObject({
      employerMatchValue: "50",
      employerMatchRate: "0.5",
    });
    const p = await t.caller.contributionProfile.create({
      name: "Invented plan",
      contributionActiveFields: {
        contributionAccounts: {
          [id]: {
            contributionValue: "6",
            contributionMethod: "percent_of_salary",
            employerMatchValue: "40",
          },
        },
        deductions: {},
      },
    });
    await expect(
      t.caller.contributionProfile.setAccountActiveFields({
        profileId: p.id,
        accountId: id,
        fields: { employerMatchRate: "1e11" },
      }),
    ).rejects.toThrow(/200%/);
    expect(entries(p.id)[id]).toMatchObject({
      employerMatchValue: "40",
      employerMatchRate: "0.4",
    });
  });

  it("does not bound a value an entry borrows", async () => {
    const a = (await t.caller.settings.contributionAccounts.create({
      ...account,
      personId,
      jobId,
      employerMatchType: "fixed_annual",
      employerMatchValue: "5000",
    }))!.id;
    const p = await t.caller.contributionProfile.create({
      name: "Invented plan",
      contributionActiveFields: {
        contributionAccounts: {
          [a]: {
            contributionValue: "6",
            contributionMethod: "percent_of_salary",
            employerMatchType: "percent_of_contribution",
          },
        },
        deductions: {},
      },
    });
    expect(entries(p.id)[a]).toMatchObject({ employerMatchRate: "50" });
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

describe("the profile entry write", () => {
  async function profileWith(
    accountId: number,
    entry: Record<string, unknown>,
  ) {
    const p = await t.caller.contributionProfile.create({
      name: "Invented plan",
      contributionActiveFields: {
        contributionAccounts: {
          [accountId]: {
            contributionValue: "6",
            contributionMethod: "percent_of_salary",
            ...entry,
          },
        },
        deductions: {},
      },
    });
    return p.id;
  }
  const patch = (
    profileId: number,
    accountId: number,
    fields: Record<string, unknown>,
    unset?: string[],
  ) =>
    t.caller.contributionProfile.setAccountActiveFields({
      profileId,
      accountId,
      fields,
      unset,
    });

  it("create writes an entry's own rate, and drops a rate sent beside a value", async () => {
    const a = await percentAccount("50");
    const p = await profileWith(a, {
      employerMatchValue: "40",
      employerMatchRate: "0.9",
    });
    expect(entries(p)[a]).toMatchObject({
      employerMatchValue: "40",
      employerMatchRate: "0.4",
    });
  });

  it("a patched value moves its rate; a patched rate moves its value", async () => {
    const a = await percentAccount("50");
    const p = await profileWith(a, { employerMatchValue: "40" });
    await patch(p, a, { employerMatchValue: "45" });
    expect(entries(p)[a]).toMatchObject({
      employerMatchValue: "45",
      employerMatchRate: "0.45",
    });
    await patch(p, a, { employerMatchRate: "0.3" });
    expect(entries(p)[a]).toMatchObject({
      employerMatchValue: "30",
      employerMatchRate: "0.3",
    });
  });

  it("unsetting the value, or a dollar type, drops the rate", async () => {
    const a = await percentAccount("50");
    const p = await profileWith(a, { employerMatchValue: "40" });
    await patch(p, a, {}, ["employerMatchValue"]);
    expect(entries(p)[a]).not.toHaveProperty("employerMatchRate");
    await patch(p, a, { employerMatchValue: "40" });
    await patch(p, a, { employerMatchType: "dollar_match" });
    expect(entries(p)[a]).not.toHaveProperty("employerMatchRate");
    expect(entries(p)[a]).toMatchObject({ employerMatchValue: "40" });
  });

  it("refuses a patched rate past 200%, and edits an entry stored above it", async () => {
    const a = await percentAccount("50");
    const p = await profileWith(a, { employerMatchValue: "40" });
    await expect(patch(p, a, { employerMatchRate: "5" })).rejects.toThrow(
      /200%/,
    );
    const stored = entries(p);
    stored[a] = {
      ...stored[a],
      employerMatchValue: "300",
      employerMatchRate: "3",
    };
    t.db
      .update(sqliteSchema.contributionProfiles)
      .set({
        contributionActiveFields: {
          contributionAccounts: stored,
          deductions: {},
        },
      })
      .where(eq(sqliteSchema.contributionProfiles.id, p))
      .run();
    await patch(p, a, {
      contributionValue: "7",
      contributionMethod: "percent_of_salary",
    });
    expect(entries(p)[a]).toMatchObject({
      contributionValue: "7",
      employerMatchRate: "3",
    });
  });
});

describe("readers take the rate, and the whole percent when none is stored", () => {
  it("a profile's match reads the account's rate; with none, its value", async () => {
    const a = await percentAccount("50");
    const p = await t.caller.contributionProfile.create({
      name: "Invented plan",
      contributionActiveFields: {
        contributionAccounts: {
          [a]: {
            contributionValue: "6",
            contributionMethod: "percent_of_salary",
          },
        },
        deductions: {},
      },
    });
    const match = async () =>
      (await t.caller.contributionProfile.list()).find((x) => x.id === p.id)!
        .summary.annualEmployerMatch;
    const setRate = (rate: string | null) =>
      t.db
        .update(sqliteSchema.contributionAccounts)
        .set({ employerMatchRate: rate })
        .where(eq(sqliteSchema.contributionAccounts.id, a))
        .run();
    const withRate = await match();
    expect(withRate).toBeGreaterThan(0);
    setRate(null);
    expect(await match()).toBe(withRate);
    setRate("0.25");
    expect(await match()).toBeCloseTo(withRate / 2, 6);
  });
});
