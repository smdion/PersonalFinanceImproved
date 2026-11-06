/** The match writes, through the real procedures, shared by the SQLite and
 *  PostgreSQL files (advisor E8 M11, E9 M15): an edited value moves its
 *  rate, leaving the percent type clears it, the bound refuses only a
 *  raised rate, and an account change re-resolves its profile entries.
 *
 *  Imports only types from the app: the PostgreSQL file must point
 *  DATABASE_URL at its database before the db module is first imported. */
import { describe, it, expect } from "vitest";
import type { AppRouter } from "@/server/routers";

type Caller = ReturnType<AppRouter["createCaller"]>;
type Fields = Record<string, unknown>;

export interface MatchRateDb {
  caller: Caller;
  personId: number;
  jobId: number;
  /** An account row, its decimals as SQLite gives them ("50", "0.5"). */
  row: (id: number) => Promise<Fields>;
  /** A profile's stored contributionAccounts entries. */
  entries: (profileId: number) => Promise<Record<string, Fields>>;
  /** Writes match columns straight to the row, past the writer. */
  setAccount: (
    id: number,
    set: {
      employerMatchValue?: string | null;
      employerMatchRate?: string | null;
    },
  ) => Promise<void>;
  /** Writes a profile's contribution_active_fields as given; null: JSON null. */
  setFields: (profileId: number, fields: Fields | null) => Promise<void>;
}

/** PostgreSQL's numeric text as SQLite's: "50.00" → "50", "0.500000" → "0.5". */
export function sqliteDecimal(v: unknown): unknown {
  if (typeof v !== "string" || !/^-?\d+\.\d+$/.test(v)) return v;
  return v.replace(/0+$/, "").replace(/\.$/, "");
}

export function matchRateWriteCases(h: () => MatchRateDb): void {
  const account = {
    accountType: "401k" as const,
    parentCategory: "Retirement" as const,
    taxTreatment: "pre_tax" as const,
    employerMaxMatchPct: "0.06",
  };
  const row = (id: number) => h().row(id);
  const entries = (id: number) => h().entries(id);

  async function percentAccount(value: string) {
    const created = await h().caller.settings.contributionAccounts.create({
      ...account,
      personId: h().personId,
      jobId: h().jobId,
      employerMatchType: "percent_of_contribution",
      employerMatchValue: value,
    });
    return created!.id;
  }
  const update = (id: number, fields: Record<string, unknown>) =>
    h().caller.settings.contributionAccounts.update({
      id,
      ...account,
      personId: h().personId,
      jobId: h().jobId,
      employerMatchType: "percent_of_contribution",
      ...fields,
    });

  describe("the account write", () => {
    it("a percent create writes the rate; an edited value moves it", async () => {
      const id = await percentAccount("50");
      expect(await row(id)).toMatchObject({
        employerMatchValue: null,
        employerMatchRate: "0.5",
      });
      await update(id, { employerMatchValue: "60" });
      expect(await row(id)).toMatchObject({
        employerMatchValue: null,
        employerMatchRate: "0.6",
      });
    });

    it("a sent rate sets the value beside it", async () => {
      const id = await percentAccount("50");
      await update(id, {
        employerMatchValue: "50",
        employerMatchRate: "0.035",
      });
      expect(await row(id)).toMatchObject({
        employerMatchValue: null,
        employerMatchRate: "0.035",
      });
    });

    it("leaving the percent type clears the rate", async () => {
      const id = await percentAccount("50");
      await update(id, {
        employerMatchType: "dollar_match",
        employerMatchValue: "500",
      });
      expect(await row(id)).toMatchObject({
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
      await h().setAccount(id, {
        employerMatchValue: "300",
        employerMatchRate: "3",
      });
      await update(id, { employerMatchValue: "300", notes: "unrelated edit" });
      expect(await row(id)).toMatchObject({
        employerMatchRate: "3",
        notes: "unrelated edit",
      });
    });
  });

  describe("an account's type change", () => {
    it("an entry that takes its type from the account follows it, and keeps its rate", async () => {
      const a = (await h().caller.settings.contributionAccounts.create({
        ...account,
        personId: h().personId,
        jobId: h().jobId,
        employerMatchType: "dollar_match",
        employerMatchValue: "500",
      }))!.id;
      const p = await h().caller.contributionProfile.create({
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
      expect((await entries(p.id))[a]).not.toHaveProperty("employerMatchRate");
      await update(a, { employerMatchValue: "50" });
      expect((await entries(p.id))[a]).toMatchObject({
        employerMatchRate: "0.4",
      });
      // Under dollars the entry reads its whole percent as dollars, as
      // before 0017; its rate stays for a switch back (never removed).
      await update(a, {
        employerMatchType: "fixed_annual",
        employerMatchValue: "1000",
      });
      expect((await entries(p.id))[a]).toMatchObject({
        employerMatchValue: "40",
        employerMatchRate: "0.4",
      });
    });

    // Q22 (advisor E9 list item 3): a rate 0016 or a write baked from a
    // non-percent account is the entry's own; nothing bakes it again.
    it("keeps a borrowed rate when the account's value changes", async () => {
      const a = (await h().caller.settings.contributionAccounts.create({
        ...account,
        personId: h().personId,
        jobId: h().jobId,
        employerMatchType: "dollar_match",
        employerMatchValue: "40",
      }))!.id;
      const p = await h().caller.contributionProfile.create({
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
      expect((await entries(p.id))[a]).toMatchObject({
        employerMatchRate: "0.4",
      });
      await update(a, {
        employerMatchType: "dollar_match",
        employerMatchValue: "60",
      });
      expect((await entries(p.id))[a]).toMatchObject({
        employerMatchRate: "0.4",
      });
      await h().caller.contributionProfile.setAccountActiveFields({
        profileId: p.id,
        accountId: a,
        fields: { isActive: true },
      });
      expect((await entries(p.id))[a]).toMatchObject({
        employerMatchRate: "0.4",
      });
    });

    it("refuses a sent rate with no percent, on the account and the entry", async () => {
      const id = await percentAccount("50");
      for (const rate of ["1e11", "-1e11", "abc"])
        await expect(update(id, { employerMatchRate: rate })).rejects.toThrow();
      expect(await row(id)).toMatchObject({
        employerMatchValue: null,
        employerMatchRate: "0.5",
      });
      const p = await h().caller.contributionProfile.create({
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
        h().caller.contributionProfile.setAccountActiveFields({
          profileId: p.id,
          accountId: id,
          fields: { employerMatchRate: "1e11" },
        }),
      ).rejects.toThrow(/200%/);
      expect((await entries(p.id))[id]).toMatchObject({
        employerMatchRate: "0.4",
      });
    });

    it("does not bound a value an entry borrows", async () => {
      const a = (await h().caller.settings.contributionAccounts.create({
        ...account,
        personId: h().personId,
        jobId: h().jobId,
        employerMatchType: "fixed_annual",
        employerMatchValue: "5000",
      }))!.id;
      const p = await h().caller.contributionProfile.create({
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
      expect((await entries(p.id))[a]).toMatchObject({
        employerMatchRate: "50",
      });
    });

    it("refuses a value too large for a rate", async () => {
      const id = await percentAccount("50");
      await expect(
        update(id, { employerMatchValue: "100000000" }),
      ).rejects.toThrow(/200%/);
    });

    // M14 (advisor E9 F2): a dollar value is no rate already stored.
    it("refuses a dollar value kept across a switch to percent", async () => {
      const a = (await h().caller.settings.contributionAccounts.create({
        ...account,
        personId: h().personId,
        jobId: h().jobId,
        employerMatchType: "dollar_match",
        employerMatchValue: "5000",
      }))!.id;
      await expect(update(a, { employerMatchValue: "5000" })).rejects.toThrow(
        /200%/,
      );
      expect(await row(a)).toMatchObject({
        employerMatchType: "dollar_match",
        employerMatchRate: null,
      });
    });

    it("refuses a new percent finer than two decimals", async () => {
      const id = await percentAccount("50");
      await expect(
        update(id, { employerMatchValue: "12.345" }),
      ).rejects.toThrow(/two decimals/);
    });
  });

  describe("the profile entry write", () => {
    async function profileWith(
      accountId: number,
      entry: Record<string, unknown>,
    ) {
      const p = await h().caller.contributionProfile.create({
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
      h().caller.contributionProfile.setAccountActiveFields({
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
      expect((await entries(p))[a]).toMatchObject({
        employerMatchRate: "0.4",
      });
    });

    it("a patched value moves its rate; a patched rate moves its value", async () => {
      const a = await percentAccount("50");
      const p = await profileWith(a, { employerMatchValue: "40" });
      await patch(p, a, { employerMatchValue: "45" });
      expect((await entries(p))[a]).toMatchObject({
        employerMatchRate: "0.45",
      });
      await patch(p, a, { employerMatchRate: "0.3" });
      expect((await entries(p))[a]).toMatchObject({
        employerMatchRate: "0.3",
      });
    });

    it("unsetting the value of an entry held as a rate alone unsets the rate", async () => {
      const a = await percentAccount("50");
      const p = await profileWith(a, { employerMatchValue: "40" });
      expect((await entries(p))[a]).not.toHaveProperty("employerMatchValue");
      await patch(p, a, {}, ["employerMatchValue"]);
      expect((await entries(p))[a]).not.toHaveProperty("employerMatchRate");
    });

    it("unsetting the value, or a dollar type, drops the rate", async () => {
      const a = await percentAccount("50");
      const p = await profileWith(a, { employerMatchValue: "40" });
      await patch(p, a, {}, ["employerMatchValue"]);
      expect((await entries(p))[a]).not.toHaveProperty("employerMatchRate");
      await patch(p, a, { employerMatchValue: "40" });
      await patch(p, a, { employerMatchType: "dollar_match" });
      expect((await entries(p))[a]).not.toHaveProperty("employerMatchRate");
      expect((await entries(p))[a]).toMatchObject({ employerMatchValue: "40" });
    });

    // M14 (advisor E9 F2), the entry's own type.
    it("refuses an entry's dollar value kept across its switch to percent", async () => {
      const a = await percentAccount("50");
      const p = await profileWith(a, {
        employerMatchType: "dollar_match",
        employerMatchValue: "5000",
      });
      await expect(
        patch(p, a, { employerMatchType: "percent_of_contribution" }),
      ).rejects.toThrow(/200%/);
      expect((await entries(p))[a]).toMatchObject({
        employerMatchType: "dollar_match",
      });
      expect((await entries(p))[a]).not.toHaveProperty("employerMatchRate");
    });

    it("refuses a patched rate past 200%, and edits an entry stored above it", async () => {
      const a = await percentAccount("50");
      const p = await profileWith(a, { employerMatchValue: "40" });
      await expect(patch(p, a, { employerMatchRate: "5" })).rejects.toThrow(
        /200%/,
      );
      const stored = await entries(p);
      stored[a] = {
        ...stored[a],
        employerMatchValue: "300",
        employerMatchRate: "3",
      };
      await h().setFields(p, { contributionAccounts: stored, deductions: {} });
      await patch(p, a, {
        contributionValue: "7",
        contributionMethod: "percent_of_salary",
      });
      expect((await entries(p))[a]).toMatchObject({
        contributionValue: "7",
        employerMatchRate: "3",
      });
    });
  });

  // M16 (advisor E9 F3): 0017 leaves a percent row its rate alone; a full
  // update (every field resent from the cached row) must not erase it.
  describe("a resent value keeps the stored rate", () => {
    it("a notes-only full update of a rate with no value keeps the rate", async () => {
      const id = await percentAccount("50");
      await h().setAccount(id, {
        employerMatchValue: null,
        employerMatchRate: "0.5",
      });
      await update(id, { employerMatchValue: null, notes: "unrelated edit" });
      expect(await row(id)).toMatchObject({
        employerMatchRate: "0.5",
        notes: "unrelated edit",
      });
      await update(id, {
        employerMatchValue: null,
        employerMatchRate: "0.5",
        notes: "sent with its rate",
      });
      expect(await row(id)).toMatchObject({ employerMatchRate: "0.5" });
    });

    it("a changed value still moves it", async () => {
      const id = await percentAccount("50");
      await h().setAccount(id, {
        employerMatchValue: null,
        employerMatchRate: "0.5",
      });
      await update(id, { employerMatchValue: "60" });
      expect(await row(id)).toMatchObject({
        employerMatchValue: null,
        employerMatchRate: "0.6",
      });
    });
  });

  // M17 (advisor E9 F5): a hand-edited profile column holding JSON null.
  it("an account update saves beside a profile whose fields are JSON null", async () => {
    const a = await percentAccount("50");
    const p = await h().caller.contributionProfile.create({
      name: "Invented plan",
      contributionActiveFields: { contributionAccounts: {}, deductions: {} },
    });
    await h().setFields(p.id, null);
    try {
      await update(a, { employerMatchValue: "60" });
      expect(await row(a)).toMatchObject({ employerMatchRate: "0.6" });
    } finally {
      await h().setFields(p.id, { contributionAccounts: {}, deductions: {} });
    }
  });
}
