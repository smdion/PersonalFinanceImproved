/**
 * A v0.10.1 backup is labelled 0013, older than the current schema, so a
 * restore runs it through the whole transform ladder. A current-shape
 * export of each baseline household, labelled 0013, comes back unchanged
 * apart from the displayNameActive rename. Settings rows without a
 * retirement profile are the one state the ladder adds to: it creates one.
 */
// First: the SQLite harness's mocks, then the baseline's.
import "../routers/setup-mocks";
import "../baseline/mocks";
import { describe, it, expect } from "vitest";
import { createTestCaller } from "../routers/setup";
import { seedHousehold, type Household } from "../baseline/seed";
import { HOUSEHOLDS } from "../baseline/households";
import { exportBackup } from "@/lib/db/version-logic";
import { transformBackupToCurrentSchema } from "@/lib/db/backup-transforms";
import pgJournal from "../../drizzle/meta/_journal.json";

const V0101 = "0013_v097_loan_feed";
const CURRENT = pgJournal.entries.at(-1)!.tag;
const OLD_NAME = "Invented old name";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/** The household as a backup holds it: every versioned table, JSON-safe. */
async function exported(household: Household): Promise<Tables> {
  const { caller, rawDb, cleanup } = await createTestCaller();
  try {
    await seedHousehold(caller, household);
    return JSON.parse(
      JSON.stringify((await exportBackup(rawDb)).tables),
    ) as Tables;
  } finally {
    await cleanup();
  }
}

const parsed = (v: unknown): Row =>
  (typeof v === "string" ? JSON.parse(v) : v) as Row;

/**
 * The backup with one profile entry still holding the old key (as v0.10.1
 * could store it), and the same backup as the restore step should leave it.
 * A household with no account entries has nothing to rename.
 */
function withOldKey(tables: Tables): { input: Tables; expected: Tables } {
  const input = structuredClone(tables);
  const expected = structuredClone(tables);
  const i = input["contribution_profiles"]!.findIndex(
    (p) =>
      Object.keys(
        (parsed(p["contribution_active_fields"])["contributionAccounts"] ??
          {}) as Row,
      ).length > 0,
  );
  if (i < 0) return { input, expected };
  const fields = parsed(
    input["contribution_profiles"]![i]!["contribution_active_fields"],
  );
  const accounts = fields["contributionAccounts"] as Record<string, Row>;
  const [id, entry] = Object.entries(accounts)[0]!;
  const { displayNameCustom: _custom, ...rest } = entry;
  const old = {
    ...fields,
    contributionAccounts: {
      ...accounts,
      [id]: { ...rest, displayNameActive: OLD_NAME },
    },
  };
  input["contribution_profiles"]![i]!["contribution_active_fields"] =
    JSON.stringify(old);
  expected["contribution_profiles"]![i]!["contribution_active_fields"] = {
    ...fields,
    contributionAccounts: {
      ...accounts,
      [id]: { ...rest, displayNameCustom: OLD_NAME },
    },
  };
  return { input, expected };
}

describe("a v0.10.1 backup (schema 0013) through the restore ladder", () => {
  it.each(HOUSEHOLDS.map((h) => [h.key, h] as const))(
    "%s comes back unchanged except for the rename",
    async (_key, household) => {
      const { input, expected } = withOldKey(await exported(household));
      const before = structuredClone(input);
      const { tables, transformed } = transformBackupToCurrentSchema(
        input,
        V0101,
        CURRENT,
      );
      expect(transformed).toBe(true);
      expect(tables).toEqual(expected);
      expect(input).toEqual(before);
    },
  );

  it("settings rows with no retirement profile gain a Current Plan profile", async () => {
    const tables = await exported(HOUSEHOLDS[0]!);
    expect(tables["retirement_settings"]!.length).toBeGreaterThan(0);
    expect(tables["retirement_profiles"]!.length).toBeGreaterThan(0);
    const input = { ...structuredClone(tables), retirement_profiles: [] };
    const { tables: out } = transformBackupToCurrentSchema(
      input,
      V0101,
      CURRENT,
    );
    const { retirement_profiles: added, ...others } = out;
    const { retirement_profiles: _none, ...unchanged } = input;
    expect(others).toEqual(unchanged);
    // The settings rows already name profile 1, so they now point at it.
    expect(
      new Set(out["retirement_settings"]!.map((r) => (r as Row)["profile_id"])),
    ).toEqual(new Set([1]));
    expect(added).toEqual([
      {
        id: 1,
        name: "Current Plan",
        description: expect.any(String),
        created_at: expect.any(String),
        tax_params_year: null,
      },
    ]);
  });
});
