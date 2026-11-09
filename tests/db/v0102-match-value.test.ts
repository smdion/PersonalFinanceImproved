/**
 * Migration 0017's converter (a percent match keeps its rate alone) as the
 * restore step runs it: every case of match-value-cases.ts, JSON text too,
 * a second pass changes nothing, and the restore ladder runs 0016 then 0017
 * in one loop, a no-op run again over its own output. M12 (advisor E8/E9):
 * on every 0016 case, the match today's reader reads before 0016 is the one
 * it reads after both.
 */
import { describe, it, expect, vi } from "vitest";
import {
  MATCH_VALUE_CONVERTER,
  MATCH_VALUE_TAG,
} from "@/lib/db/v0102-match-value";
import { MATCH_RATE_TAG } from "@/lib/db/v0102-match-rate";
import {
  MIGRATION_CONVERTERS,
  convertBackup,
  convertBackupInOrder,
} from "@/lib/db/migration-converters";
import { transformBackupToCurrentSchema } from "@/lib/db/backup-transforms";
import { contribAccountActiveFieldsSchema } from "@/lib/db/shapes/json-schemas";
import { parseEmployerMatch } from "@/lib/pure/contributions/contribution-amount";
import { storedMatchRate } from "@/lib/pure/contributions/employer-match";
import { applyContribActiveFields } from "@/server/services/contributions/profile";
import { toNumber } from "@/lib/utils/numbers";
import pgJournal from "../../drizzle/meta/_journal.json";
import { VALUE_ACCOUNTS, VALUE_PROFILES } from "./match-value-cases";
import { ACCOUNT_CASES, PROFILE_CASES } from "./match-rate-cases";

// applyContribActiveFields' module loads the app's schema with a runtime
// require only the app's bundler resolves; the merge itself never reads it.
vi.mock("@/lib/db/schema", () => ({}));

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
const CURRENT = pgJournal.entries.at(-1)!.tag;

/** A backup at 0016: every 0017 case. */
function at0016(): Tables {
  return {
    contribution_accounts: VALUE_ACCOUNTS.map((c) => ({
      id: c.id,
      account_type: "401k",
      employer_match_type: c.type,
      employer_match_value: c.value,
      employer_match_rate: c.rate,
    })),
    contribution_profiles: VALUE_PROFILES.map((c, i) => ({
      id: i + 1,
      name: `Invented ${i}`,
      contribution_active_fields: structuredClone(c.before),
    })),
  };
}
const values = (t: Tables) =>
  t["contribution_accounts"]!.map((r) => r["employer_match_value"]);
const fields = (t: Tables) =>
  t["contribution_profiles"]!.map((r) => r["contribution_active_fields"]);

describe("migration 0017's converter", () => {
  it("is registered after 0016, in journal order, and runs after the tag's SQL", () => {
    expect(MIGRATION_CONVERTERS[MATCH_VALUE_TAG]).toBe(MATCH_VALUE_CONVERTER);
    expect(MATCH_VALUE_CONVERTER.runs).toBe("afterSql");
    const journal = pgJournal.entries.map((e) => e.tag);
    const registered = Object.keys(MIGRATION_CONVERTERS);
    expect(registered).toEqual([MATCH_RATE_TAG, MATCH_VALUE_TAG]);
    const inJournal = registered.filter((t) => journal.includes(t));
    expect(inJournal.map((t) => journal.indexOf(t))).toEqual(
      [...inJournal.map((t) => journal.indexOf(t))].sort((a, b) => a - b),
    );
  });

  it("gives every case its cleared form, and a second pass changes nothing", () => {
    const tables = at0016();
    convertBackup(tables, MIGRATION_CONVERTERS, MATCH_VALUE_TAG);
    expect(values(tables)).toEqual(VALUE_ACCOUNTS.map((c) => c.after));
    expect(fields(tables)).toEqual(VALUE_PROFILES.map((c) => c.after));
    const once = structuredClone(tables);
    expect(
      convertBackup(tables, MIGRATION_CONVERTERS, MATCH_VALUE_TAG)?.updates,
    ).toBe(0);
    expect(tables).toEqual(once);
  });

  it("leaves every rate and other column as it was", () => {
    const tables = at0016();
    convertBackup(tables, MIGRATION_CONVERTERS, MATCH_VALUE_TAG);
    const strip = (t: Tables) =>
      t["contribution_accounts"]!.map(({ employer_match_value: _, ...r }) => r);
    expect(strip(tables)).toEqual(strip(at0016()));
  });

  it("reads JSON text (SQLite) as well as objects", () => {
    const tables = at0016();
    for (const p of tables["contribution_profiles"]!)
      p["contribution_active_fields"] = JSON.stringify(
        p["contribution_active_fields"],
      );
    convertBackup(tables, MIGRATION_CONVERTERS, MATCH_VALUE_TAG);
    expect(
      fields(tables).map((f): unknown =>
        typeof f === "string" ? JSON.parse(f) : f,
      ),
    ).toEqual(VALUE_PROFILES.map((c) => c.after));
  });

  it("notes what it cleared and copied, and names the values it kept", () => {
    const r = convertBackup(at0016(), MIGRATION_CONVERTERS, MATCH_VALUE_TAG)!;
    expect(r.notes[0]).toBe(
      "2 account values, 4 entry values cleared; 2 dollar entries given the account's value",
    );
    expect(r.notes[1]).toBe(
      "kept their value (no rate): account 3, account 4, account 8",
    );
  });

  it("every entry it leaves passes the strict entry schema", () => {
    let checked = 0;
    for (const c of VALUE_PROFILES) {
      const stored = (c.after as { contributionAccounts?: unknown } | null)
        ?.contributionAccounts;
      if (typeof stored !== "object" || stored === null) continue;
      for (const entry of Object.values(stored as Record<string, Row>)) {
        if (entry["employerMatchValue"] === null) continue; // hand-stored
        expect(contribAccountActiveFieldsSchema.safeParse(entry).success).toBe(
          true,
        );
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});

describe("the restore step runs every converter in journal order", () => {
  it("a backup at 0016 is cleared", () => {
    const { tables } = transformBackupToCurrentSchema(
      at0016(),
      MATCH_RATE_TAG,
      CURRENT,
    );
    expect(values(tables as Tables)).toEqual(
      VALUE_ACCOUNTS.map((c) => c.after),
    );
    expect(fields(tables as Tables)).toEqual(
      VALUE_PROFILES.map((c) => c.after),
    );
  });

  it("convertBackupInOrder runs 0016 before 0017, and notes each", () => {
    const tables = at0016();
    const runs = convertBackupInOrder(tables);
    expect(runs.map((r) => r.tag)).toEqual([MATCH_RATE_TAG, MATCH_VALUE_TAG]);
  });

  /** A restore's output, restored again on a later release: the loop runs
   *  twice more over it and changes nothing. */
  function rerunTwice(restored: Tables) {
    const first = structuredClone(restored);
    for (let pass = 0; pass < 2; pass++) {
      const runs = convertBackupInOrder(restored);
      expect(runs.map((r) => r.tag)).toEqual([MATCH_RATE_TAG, MATCH_VALUE_TAG]);
      for (const { run } of runs) expect(run.updates).toBe(0);
      expect(restored).toEqual(first);
    }
  }

  it("run again over its own output changes nothing: the 0017 cases", () => {
    const { tables } = transformBackupToCurrentSchema(
      at0016(),
      MATCH_RATE_TAG,
      CURRENT,
    );
    rerunTwice(tables as Tables);
  });

  it.each([
    "0015_v0102_dead_data",
    "0013_v097_loan_feed",
    "0008_v088_paycheck_earnings",
  ])(
    "run again over its own output changes nothing: the 0016 cases from %s",
    (from) => {
      const { tables } = transformBackupToCurrentSchema(
        before0016(),
        from,
        CURRENT,
      );
      rerunTwice(tables as Tables);
    },
  );
});

/** An 0016 case backup from before 0016 (v0.10.1's shape). */
function before0016(): Tables {
  return {
    contribution_accounts: ACCOUNT_CASES.map((c) => ({
      id: c.id,
      account_type: "401k",
      sub_type: c.subType ?? null,
      employer_match_type: c.type,
      employer_match_value: c.value,
    })),
    contribution_profiles: PROFILE_CASES.map((c, i) => ({
      id: i + 1,
      contribution_active_fields: structuredClone(c.before),
    })),
  };
}

type AccountRow = Parameters<typeof applyContribActiveFields>[0][number];
/** An account row with no match; readMatch sets its match columns. */
const BLANK_ROW: AccountRow = {
  id: 1,
  jobId: null,
  personId: null,
  accountType: "401k",
  subType: null,
  label: null,
  parentCategory: "Retirement",
  taxTreatment: "pre_tax",
  employerMatchType: "none",
  employerMatchValue: null,
  employerMatchRate: null,
  employerMaxMatchPct: null,
  employerMatchTaxTreatment: "pre_tax",
  hsaCoverageType: null,
  autoMaximize: false,
  isActive: true,
  ownership: "individual",
  performanceAccountId: null,
  targetAnnual: null,
  allocationPriority: 0,
  notes: null,
  isPayrollDeducted: null,
  priorYearContribAmount: "0",
  priorYearContribYear: null,
};

/** The match today's reader reads for one account, alone or through one
 *  entry merged by applyContribActiveFields (as an overlay, so an entry
 *  with no contribution value still merges); null when the merge drops it. */
function readMatch(account: Row | undefined, entry: Row | undefined) {
  const row: AccountRow = {
    ...BLANK_ROW,
    // A backup's stored type is any text, as the reader meets it.
    employerMatchType: (account?.["employer_match_type"] ??
      null) as AccountRow["employerMatchType"],
    employerMatchValue: stored(account?.["employer_match_value"]),
    employerMatchRate: stored(account?.["employer_match_rate"]),
  };
  const [merged] = entry
    ? applyContribActiveFields([row], { [row.id]: entry }, true)
    : [row];
  if (!merged) return null;
  return parseEmployerMatch(
    merged.employerMatchType == null ? null : String(merged.employerMatchType),
    toNumber(
      merged.employerMatchValue == null
        ? null
        : String(merged.employerMatchValue),
    ),
    0.06,
    storedMatchRate(merged.employerMatchRate),
  );
}
/** A stored decimal column as the row type holds it. */
const stored = (v: unknown) => (v == null ? null : String(v));

/** Every account alone and every entry on its account, read. */
function reads(t: Tables) {
  const accounts = new Map(
    t["contribution_accounts"]!.map((a) => [String(a["id"]), a]),
  );
  const out: unknown[] = [...accounts.values()].map((a) =>
    readMatch(a, undefined),
  );
  for (const p of t["contribution_profiles"]!) {
    let f: unknown = p["contribution_active_fields"];
    if (typeof f === "string") f = JSON.parse(f);
    const entries = (f as { contributionAccounts?: unknown } | null)
      ?.contributionAccounts;
    if (typeof entries !== "object" || entries === null) continue;
    for (const [id, entry] of Object.entries(
      entries as Record<string, unknown>,
    ))
      if (typeof entry === "object" && entry !== null && !Array.isArray(entry))
        out.push([id, readMatch(accounts.get(id), entry as Row)]);
  }
  return out;
}

describe("M12: no match moves across 0016 and 0017", () => {
  it.each([
    "0015_v0102_dead_data",
    "0013_v097_loan_feed",
    "0008_v088_paycheck_earnings",
  ])("for every 0016 case, restored from %s", (from) => {
    const { tables } = transformBackupToCurrentSchema(
      before0016(),
      from,
      CURRENT,
    );
    expect(reads(tables as Tables)).toEqual(reads(before0016()));
  });

  it("a type-only dollar entry over a percent account reads the same dollars, and a skipped value survives", () => {
    const { tables } = transformBackupToCurrentSchema(
      before0016(),
      "0015_v0102_dead_data",
      CURRENT,
    );
    const t = tables as Tables;
    const dollarCase = PROFILE_CASES.findIndex((c) =>
      c.name.includes("step 3"),
    );
    expect(dollarCase).toBeGreaterThanOrEqual(0);
    const entries = (
      t["contribution_profiles"]![dollarCase]![
        "contribution_active_fields"
      ] as {
        contributionAccounts: Record<string, Row>;
      }
    ).contributionAccounts;
    expect(
      Object.values(entries).some((e) => e["employerMatchValue"] !== undefined),
    ).toBe(true);
    const skipped = ACCOUNT_CASES.filter(
      (c) =>
        c.type === "percent_of_contribution" &&
        c.value !== null &&
        c.after === null,
    );
    expect(skipped.length).toBeGreaterThan(0);
    for (const c of skipped)
      expect(
        t["contribution_accounts"]!.find((a) => a["id"] === c.id)?.[
          "employer_match_value"
        ],
      ).toBe(c.value);
  });
});
