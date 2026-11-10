/** The job-entries tag, live and on restore: a Salary Profile entry keyed
 *  by a job id the jobs table lacks (a job delete left it) goes. */
// No import from migration-converters.ts, which registers this one.
import { isRow, jsonObject, type Row, type Update } from "./converter-rows";

/** The job-entries tag. */
export const JOB_ENTRIES_TAG = "0021_v0110_job_entries";

// Gated on structure only (a key with no jobs row of that id); removing a
// key is a projection, so a replay finds nothing. A backup without a jobs
// table is left as it is.
export const JOB_ENTRIES_CONVERTER = {
  tables: ["salary_profiles", "jobs"],
  runs: "afterSql",
  convert: (
    tables: Readonly<Record<string, readonly unknown[] | undefined>>,
  ) => {
    const updates: Update[] = [];
    const jobRows = tables["jobs"];
    if (!jobRows) return { updates, notes: ["no jobs table: nothing read"] };
    const jobs = new Set(jobRows.filter(isRow).map((j) => String(j["id"])));
    let removed = 0;
    for (const profile of (tables["salary_profiles"] ?? []).filter(isRow)) {
      const salaries = jsonObject(profile["salaries"]);
      if (!salaries) continue;
      const kept: Row = {};
      for (const [jobId, entry] of Object.entries(salaries))
        if (jobs.has(jobId)) kept[jobId] = entry;
        else removed++;
      if (Object.keys(kept).length < Object.keys(salaries).length)
        updates.push({
          table: "salary_profiles",
          id: Number(profile["id"]),
          set: { salaries: kept },
        });
    }
    return {
      updates,
      notes: [
        `${removed} Salary Profile entries for deleted jobs removed from ${updates.length} profiles`,
      ],
    };
  },
} as const;
