/** The money tag's extra-paycheck routings, live and on restore: a rule's
 *  `netPaySnapshot` goes where nothing reads it, and a routing that still
 *  pays from it refuses the start. Rules: NET_PAY_SNAPSHOT_CONVERTER. */
// No import from migration-converters.ts, which registers this one.
import { ConverterRefusal } from "./converter-refusal";
import {
  asBool,
  isRow,
  jsonObject,
  type Row,
  type Update,
} from "./converter-rows";

const SNAPSHOT = "netPaySnapshot";

const STILL_PAID = "net_pay_snapshot_in_savings_mode";

/** The one refusal this converter throws: ids only, never a value. */
const REFUSALS = {
  [STILL_PAID]: {
    problem:
      "Extra-paycheck routing in Savings mode still pays from its rules' saved net pay, with no base pay",
    upgradeFix:
      "Start the previous version; for each listed Salary Profile, make it active, and for each listed job clear its end date if it has one, open its extra-paycheck routing on the Savings page (which saves its base pay), then put the end date back; then upgrade again.",
    restoreFix:
      "Restore it in the version that made it; for each listed Salary Profile, make it active, and for each listed job clear its end date if it has one, open its extra-paycheck routing on the Savings page, then put the end date back; then back up again and restore that backup here.",
  },
} as const;

const rulesOf = (routing: Row) =>
  Array.isArray(routing["rules"]) ? routing["rules"].filter(isRow) : [];

/** Some rule holds the key, whatever its value. */
const holdsSnapshot = (routing: Row) =>
  rulesOf(routing).some((r) => Object.hasOwn(r, SNAPSHOT));

/** Each rule without the key; every other part as stored. */
function withoutSnapshots(routing: Row): Row {
  const rules = Array.isArray(routing["rules"]) ? routing["rules"] : [];
  return {
    ...routing,
    rules: rules.map((r: unknown) => {
      if (!isRow(r) || !Object.hasOwn(r, SNAPSHOT)) return r;
      const { [SNAPSHOT]: _gone, ...rest } = r;
      return rest;
    }),
  };
}

/** Unread with a base pay, in Budget mode, or for a job the materializer
 *  never walks (no such job, a speculative one): the key goes. Any other
 *  routing pays it: refused. */
function routingAfter(
  routing: Row,
  jobUnread: boolean,
): Row | "refused" | null {
  if (!holdsSnapshot(routing)) return null;
  const hasBase = Object.hasOwn(routing, "baseNetPayPerCheck");
  // isExtraPaycheckBudgetMode: with rules, Budget mode is `enabled: false`.
  if (hasBase || routing["enabled"] === false || jobUnread)
    return withoutSnapshots(routing);
  return "refused";
}

/** loadExtraPaycheckJobs walks only jobs that exist and aren't speculative
 *  (a closed boolean); an ended job is decided by today's date, which a
 *  migration doesn't read, so it stays a job the materializer may walk. */
function unreadJobs(jobs: readonly Row[]) {
  const walked = new Set(
    jobs
      .filter((j) => asBool(j["is_speculative"]) !== true)
      .map((j) => Number(j["id"])),
  );
  return (jobId: string) => !walked.has(Number(jobId));
}

// Gated on structure (a rule holding the key, a job row) and closed sets
// (base pay present, `enabled` false, speculative); removing a key is a
// projection, so a replay finds nothing. Never reads a value or a date.
export const NET_PAY_SNAPSHOT_CONVERTER = {
  tables: ["salary_profiles", "jobs"],
  runs: "afterSql",
  refusals: REFUSALS,
  convert: (
    tables: Readonly<Record<string, readonly unknown[] | undefined>>,
  ) => {
    const updates: Update[] = [];
    const refusedProfiles: number[] = [];
    const refusedJobs: number[] = [];
    const unread = unreadJobs((tables["jobs"] ?? []).filter(isRow));
    for (const profile of (tables["salary_profiles"] ?? []).filter(isRow)) {
      const salaries = jsonObject(profile["salaries"]);
      if (!salaries) continue;
      const next: Row = { ...salaries };
      let changed = false;
      for (const [jobId, entry] of Object.entries(salaries)) {
        if (!isRow(entry) || !isRow(entry["extraPaycheckRouting"])) continue;
        const after = routingAfter(
          entry["extraPaycheckRouting"],
          unread(jobId),
        );
        if (after === null) continue;
        if (after === "refused") {
          refusedProfiles.push(Number(profile["id"]));
          refusedJobs.push(Number(jobId));
          continue;
        }
        next[jobId] = { ...entry, extraPaycheckRouting: after };
        changed = true;
      }
      if (changed)
        updates.push({
          table: "salary_profiles",
          id: Number(profile["id"]),
          set: { salaries: next },
        });
    }
    if (refusedProfiles.length > 0)
      throw new ConverterRefusal(STILL_PAID, {
        salary_profiles: refusedProfiles,
        jobs: refusedJobs,
      });
    return {
      updates,
      notes: [
        `${updates.length} Salary Profiles' extra-paycheck rules cleared of saved net pay`,
      ],
    };
  },
} as const;
