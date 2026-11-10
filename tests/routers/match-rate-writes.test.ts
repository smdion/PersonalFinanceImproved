/** The match writes on SQLite (./match-rate-writes-cases.ts, shared with
 *  PostgreSQL), and the readers: a profile's match reads the rate, else
 *  the whole percent. */
import "./setup-mocks";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestCaller, seedJob, seedPerson } from "./setup";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import {
  matchRateWriteCases,
  type MatchRateDb,
} from "./match-rate-writes-cases";
import { decimalText } from "./decimal-text";

type Ctx = Awaited<ReturnType<typeof createTestCaller>>;
let t: Ctx;
let h: MatchRateDb;

beforeEach(async () => {
  t = await createTestCaller();
  const personId = await seedPerson(t.db, "Invented Saver", "1985-03-01");
  const jobId = seedJob(t.db, personId);
  const { contributionAccounts: accounts, contributionProfiles: profiles } =
    sqliteSchema;
  h = {
    caller: t.caller,
    personId,
    jobId,
    row: async (id) =>
      decimalText(
        t.db.select().from(accounts).where(eq(accounts.id, id)).get()!,
      ),
    entries: async (id) =>
      (
        t.db.select().from(profiles).where(eq(profiles.id, id)).get()!
          .contributionActiveFields as {
          contributionAccounts: Record<string, Record<string, unknown>>;
        }
      ).contributionAccounts,
    setAccount: async (id, set) => {
      t.db.update(accounts).set(set).where(eq(accounts.id, id)).run();
    },
    setFields: async (id, fields) => {
      t.sqlite
        .prepare(
          "UPDATE contribution_profiles SET contribution_active_fields = ? WHERE id = ?",
        )
        .run(JSON.stringify(fields), id);
    },
  };
});
afterEach(() => t.cleanup());

matchRateWriteCases(() => h);

async function percentAccount(value: string) {
  const created = await t.caller.settings.contributionAccounts.create({
    accountType: "401k",
    parentCategory: "Retirement",
    taxTreatment: "pre_tax",
    employerMaxMatchPct: "0.06",
    personId: h.personId,
    jobId: h.jobId,
    employerMatchType: "percent_of_contribution",
    employerMatchValue: value,
  });
  return created!.id;
}

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
    const setRate = (rate: string | null, value: string | null = null) =>
      t.db
        .update(sqliteSchema.contributionAccounts)
        .set({ employerMatchRate: rate, employerMatchValue: value })
        .where(eq(sqliteSchema.contributionAccounts.id, a))
        .run();
    const withRate = await match();
    expect(withRate).toBeGreaterThan(0);
    // A row 0016 left without a rate keeps its value (item 9): read as before.
    setRate(null, "50");
    expect(await match()).toBe(withRate);
    setRate("0.25");
    expect(await match()).toBeCloseTo(withRate / 2, 6);
  });
});
