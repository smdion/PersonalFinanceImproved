import { describe, it, expect } from "vitest";
import { transformBackupToCurrentSchema } from "@/lib/db/backup-transforms";
import { contribAccountActiveFieldsSchema } from "@/lib/db/json-schemas";
import { renameDisplayNameActive } from "@/lib/db/v0102-display-name-custom";
import pgJournal from "../../drizzle/meta/_journal.json";
import { RENAME_CASES } from "./display-name-custom-cases";

const fieldsOf = (tables: Record<string, unknown[]>) =>
  (tables.contribution_profiles as Record<string, unknown>[]).map(
    (p) => p.contribution_active_fields,
  );

describe("renameDisplayNameActive", () => {
  it("moves the old key to displayNameCustom, keeping a set displayNameCustom", () => {
    const tables = {
      contribution_profiles: [
        {
          id: 1,
          contribution_active_fields: {
            contributionAccounts: {
              "1": { displayNameActive: "Old", isActive: true },
              "2": { displayNameActive: "Old", displayNameCustom: "New" },
              "3": { contributionValue: "100", contributionMethod: "percent" },
            },
            deductions: {},
          },
        },
      ],
    };
    renameDisplayNameActive(tables);
    expect(fieldsOf(tables)).toEqual([
      {
        contributionAccounts: {
          "1": { displayNameCustom: "Old", isActive: true },
          "2": { displayNameCustom: "New" },
          "3": { contributionValue: "100", contributionMethod: "percent" },
        },
        deductions: {},
      },
    ]);
    const entries = Object.values(
      (fieldsOf(tables)[0] as { contributionAccounts: object })
        .contributionAccounts,
    );
    for (const e of entries)
      expect(contribAccountActiveFieldsSchema.safeParse(e).success).toBe(true);
  });

  it("reads SQLite's JSON text and leaves a profile without the key as it was", () => {
    const text = JSON.stringify({
      contributionAccounts: { "4": { displayNameActive: "Roth" } },
    });
    const untouched = JSON.stringify({ contributionAccounts: {} });
    const tables = {
      contribution_profiles: [
        { id: 1, contribution_active_fields: text },
        { id: 2, contribution_active_fields: untouched },
        { id: 3, contribution_active_fields: null },
      ],
    };
    renameDisplayNameActive(tables);
    expect(fieldsOf(tables)).toEqual([
      { contributionAccounts: { "4": { displayNameCustom: "Roth" } } },
      untouched,
      null,
    ]);
  });

  it("runs on the restore ladder", () => {
    const { tables } = transformBackupToCurrentSchema(
      {
        contribution_profiles: [
          {
            id: 1,
            contribution_active_fields: {
              contributionAccounts: { "1": { displayNameActive: "Old" } },
            },
          },
        ],
      },
      "0005_v092_filing_status_auto",
      "0006_v095_milestones",
    );
    expect(fieldsOf(tables)).toEqual([
      { contributionAccounts: { "1": { displayNameCustom: "Old" } } },
    ]);
  });

  it("gives every shared case its converted form, from a backup's objects", () => {
    const tables = {
      contribution_profiles: RENAME_CASES.map((c, i) => ({
        id: i + 1,
        contribution_active_fields: structuredClone(c.before),
      })),
    };
    renameDisplayNameActive(tables);
    expect(fieldsOf(tables)).toEqual(RENAME_CASES.map((c) => c.after));
    renameDisplayNameActive(tables);
    expect(fieldsOf(tables)).toEqual(RENAME_CASES.map((c) => c.after));
  });

  it("leaves the backup it was given unchanged", () => {
    const input = {
      contribution_profiles: [
        {
          id: 1,
          contribution_active_fields: {
            contributionAccounts: { "1": { displayNameActive: "Old" } },
          },
        },
      ],
    };
    const before = structuredClone(input);
    transformBackupToCurrentSchema(
      input,
      "0013_v097_loan_feed",
      pgJournal.entries.at(-1)!.tag,
    );
    expect(input).toEqual(before);
  });

  it("converts a v0.10.1 backup (schema 0013): migration 0014 makes it older", () => {
    const current = pgJournal.entries.at(-1)!.tag;
    expect(current).not.toBe("0013_v097_loan_feed");
    const { tables, transformed } = transformBackupToCurrentSchema(
      {
        contribution_profiles: [
          {
            id: 1,
            name: "Invented",
            contribution_active_fields: {
              contributionAccounts: {
                "1": { displayNameActive: "Old", isActive: true },
                "2": { displayNameActive: "Old", displayNameCustom: "New" },
              },
            },
          },
        ],
      },
      "0013_v097_loan_feed",
      current,
    );
    expect(transformed).toBe(true);
    expect(fieldsOf(tables)).toEqual([
      {
        contributionAccounts: {
          "1": { displayNameCustom: "Old", isActive: true },
          "2": { displayNameCustom: "New" },
        },
      },
    ]);
  });
});
