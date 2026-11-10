/** The credentials tag's joint step, live and on restore: a joint
 *  contribution account names no person. Rules: JOINT_PERSON_IDS_CONVERTER. */
// No import from migration-converters.ts, which registers this one.
import { ConverterRefusal } from "./converter-refusal";
import { isRow, jsonObject, type Row, type Update } from "./converter-rows";

const ACCOUNTS = "contribution_accounts";
const PROFILES = "contribution_profiles";
const REFUSAL = "jointPercentOfSalaryWithoutJob";

/** The method whose salary comes from the account's person or job (the
 *  closed-set value as this tag found it, frozen). */
const PERCENT_OF_SALARY = "percent_of_salary";

/** The accounts any profile sets to a percent of salary. */
function percentOfSalaryIds(profiles: readonly Row[]): Set<string> {
  const ids = new Set<string>();
  for (const p of profiles) {
    const entries = jsonObject(p["contribution_active_fields"])?.[
      "contributionAccounts"
    ];
    if (!isRow(entries)) continue;
    for (const [id, entry] of Object.entries(entries))
      if (isRow(entry) && entry["contributionMethod"] === PERCENT_OF_SALARY)
        ids.add(id);
  }
  return ids;
}

/** Idempotent by structure: written only where a joint row names a person,
 *  a state every writer refuses. A row the tag can't decide (no job, and a
 *  profile reads its salary) refuses the start, naming ids only. */
export const JOINT_PERSON_IDS_CONVERTER = {
  tables: [ACCOUNTS, PROFILES],
  runs: "afterSql",
  refusals: {
    [REFUSAL]: {
      problem:
        "Joint contribution accounts name a person, have no job, and a Contribution Profile sets them to a percent of salary, so the upgrade can't tell whose salary they follow",
      upgradeFix:
        "Start the previous Ledgr image (safe: nothing was committed), give each listed account a job or another contribution method in every profile, then upgrade again.",
      restoreFix:
        "Restore it in the Ledgr version that made it, give each listed account a job or another contribution method in every profile, take a new backup there and restore that one.",
    },
  },
  convert: (
    tables: Readonly<Record<string, readonly unknown[] | undefined>>,
  ) => {
    const joint = (tables[ACCOUNTS] ?? [])
      .filter(isRow)
      .filter((r) => r["ownership"] === "joint" && r["person_id"] != null);
    const percent = percentOfSalaryIds((tables[PROFILES] ?? []).filter(isRow));
    const undecidable = joint.filter(
      (r) => r["job_id"] == null && percent.has(String(r["id"])),
    );
    if (undecidable.length > 0)
      throw new ConverterRefusal(REFUSAL, {
        [ACCOUNTS]: undecidable.map((r) => Number(r["id"])),
      });
    const updates: Update[] = joint.map((r) => ({
      table: ACCOUNTS,
      id: Number(r["id"]),
      set: { person_id: null },
    }));
    return {
      updates,
      notes: [
        `${updates.length} two-owner contribution accounts no longer name a person`,
      ],
    };
  },
} as const;
