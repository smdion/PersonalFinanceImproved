/**
 * The v0.8.10 data conversion, for restoring a backup taken before v0.8.10
 * (backup-transforms.ts). Migration 0009 also ran it on live tables until
 * the v0.9.0 squash folded the v0.8 line into one baseline — a database
 * that old must go through v0.8.15 first.
 */

type V0810Row = Record<string, unknown>;

/** The rows the v0.8.10 conversion reads and changes, keyed by table name
 *  (snake_case columns, as both a backup and `SELECT *` give them). */
export type V0810Tables = Record<string, V0810Row[] | undefined>;

export type V0810Result = {
  /** Salary Profiles made from older Plans' salaries (ids already set). */
  newSalaryProfiles: V0810Row[];
  /** Ids of rows changed in place, per table. */
  changed: {
    salary_profiles: Set<number>;
    contribution_profiles: Set<number>;
    scenarios: Set<number>;
  };
  /** app_settings keys to delete. */
  deletedSettings: string[];
  /** What was converted, for the log. */
  notes: string[];
};

/** A JSON column as an object: a backup or PostgreSQL gives the value,
 *  SQLite gives text. Anything unreadable is null. */
function v0810Json(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function v0810Object(value: unknown): Record<string, unknown> | null {
  const v = v0810Json(value);
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function v0810Truthy(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

/**
 * Convert v0.8.9-and-older profile data to the v0.8.10 shapes, in place:
 *
 * 1. A Plan's stored salaries (`scenarios.overrides.people[personId].salary`)
 *    become a new Salary Profile — a copy of the Plan's own (or else the
 *    active) Salary Profile with those salaries on each person's current
 *    job — and the Plan uses it.
 * 2. Where each person's bonus goes (the `bonus_destinations` setting)
 *    moves into every Salary Profile entry for that person's jobs
 *    (`bonusDestination`, only when "spending"); the setting is deleted.
 * 3. The Salary Profile's bonus switches (`include401kInBonus` /
 *    `includeBonusInContributions`) become each payroll account's own
 *    `fromBonus` in every Contribution Profile that has an entry for it —
 *    read from the active Salary Profile's entry for the account's job,
 *    else the first profile that has one — and are removed from entries.
 * 4. Duplicate Plan names get " (2)", " (3)", … so the new unique index
 *    can be built.
 *
 * Every step does nothing when its source is gone, so running it twice
 * changes nothing the second time. Only non-default values are written.
 */
export function convertV0810ProfileSets(tables: V0810Tables): V0810Result {
  const result: V0810Result = {
    newSalaryProfiles: [],
    changed: {
      salary_profiles: new Set(),
      contribution_profiles: new Set(),
      scenarios: new Set(),
    },
    deletedSettings: [],
    notes: [],
  };
  const scenarios = tables["scenarios"] ?? [];
  const salaryProfiles = tables["salary_profiles"] ?? [];
  const contributionProfiles = tables["contribution_profiles"] ?? [];
  const accounts = tables["contribution_accounts"] ?? [];
  const jobs = tables["jobs"] ?? [];
  const settings = tables["app_settings"] ?? [];

  const setting = (key: string) =>
    v0810Json(settings.find((s) => s["key"] === key)?.["value"]);
  const byId = (rows: V0810Row[]) =>
    [...rows].sort((a, b) => Number(a["id"]) - Number(b["id"]));

  // Each profile's salaries, parsed once and written back at the end.
  const salariesOf = new Map<V0810Row, Record<string, V0810Row>>();
  for (const p of salaryProfiles) {
    const s = v0810Object(p["salaries"]) as Record<string, V0810Row> | null;
    salariesOf.set(p, s ?? {});
  }
  const activeSalaryId = Number(setting("active_salary_profile_id"));
  const activeSalary =
    salaryProfiles.find((p) => Number(p["id"]) === activeSalaryId) ??
    byId(salaryProfiles)[0];
  const jobById = new Map(jobs.map((j) => [Number(j["id"]), j]));
  const currentJob = (personId: number) =>
    byId(jobs).find(
      (j) =>
        Number(j["person_id"]) === personId &&
        !j["end_date"] &&
        !v0810Truthy(j["is_speculative"]),
    );

  // 1. Plan salaries → their own Salary Profile.
  const takenProfileNames = new Set(salaryProfiles.map((p) => p["name"]));
  let nextProfileId =
    Math.max(0, ...salaryProfiles.map((p) => Number(p["id"]) || 0)) + 1;
  for (const plan of byId(scenarios)) {
    const people = v0810Object(v0810Object(plan["overrides"])?.["people"]);
    if (!people) continue;
    const base =
      salaryProfiles.find(
        (p) => Number(p["id"]) === Number(plan["salary_profile_id"]),
      ) ?? activeSalary;
    if (!base) continue;
    const salaries: Record<string, V0810Row> = JSON.parse(
      JSON.stringify(salariesOf.get(base) ?? {}),
    );
    let changed = false;
    for (const [personId, fields] of Object.entries(people)) {
      const salary = Number(v0810Object(fields)?.["salary"]);
      if (!Number.isFinite(salary)) continue;
      const job = currentJob(Number(personId));
      const current = jobs.filter(
        (j) =>
          Number(j["person_id"]) === Number(personId) &&
          !j["end_date"] &&
          !v0810Truthy(j["is_speculative"]),
      );
      if (current.length > 1)
        result.notes.push(
          `Plan ${plan["id"]}: person ${personId} has ${current.length} current jobs; their stored salary went to job ${job?.["id"]}`,
        );
      const entry = job ? salaries[String(job["id"])] : undefined;
      if (!entry) {
        result.notes.push(
          `Plan ${plan["id"]}: person ${personId} has no current job in its Salary Profile; their stored salary was not kept`,
        );
        continue;
      }
      // Same as the profile already says: nothing to keep.
      if (Number(entry["salary"]) === salary) continue;
      entry["salary"] = salary;
      changed = true;
    }
    if (!changed) continue;
    let name = `${String(plan["name"])} salary`;
    for (let n = 2; takenProfileNames.has(name); n++)
      name = `${String(plan["name"])} salary (${n})`;
    takenProfileNames.add(name);
    const profile: V0810Row = {
      id: nextProfileId++,
      name,
      description: `Made from Plan "${String(plan["name"])}" when upgrading to v0.8.10.`,
      salaries,
      // A restored backup inserts every column its rows carry.
      ...("created_at" in base ? { created_at: base["created_at"] } : {}),
    };
    result.newSalaryProfiles.push(profile);
    salariesOf.set(profile, salaries);
    plan["salary_profile_id"] = profile["id"];
    result.changed.scenarios.add(Number(plan["id"]));
    result.notes.push(
      `Plan ${plan["id"]}: its salaries became Salary Profile "${name}"`,
    );
  }
  const allSalaryProfiles = [...salaryProfiles, ...result.newSalaryProfiles];

  // 2. Bonus destinations → Salary Profile entries.
  const destinations = v0810Object(setting("bonus_destinations"));
  if (destinations) {
    for (const p of salaryProfiles) {
      for (const [jobId, entry] of Object.entries(salariesOf.get(p)!)) {
        const personId = jobById.get(Number(jobId))?.["person_id"];
        if (
          destinations[String(personId)] === "spending" &&
          entry["bonusDestination"] !== "spending"
        ) {
          entry["bonusDestination"] = "spending";
          result.changed.salary_profiles.add(Number(p["id"]));
        }
      }
    }
    for (const p of result.newSalaryProfiles) {
      for (const [jobId, entry] of Object.entries(salariesOf.get(p)!)) {
        const personId = jobById.get(Number(jobId))?.["person_id"];
        if (destinations[String(personId)] === "spending")
          entry["bonusDestination"] = "spending";
      }
    }
  }
  if (settings.some((s) => s["key"] === "bonus_destinations"))
    result.deletedSettings.push("bonus_destinations");

  // 3. Bonus switches → each payroll account's fromBonus.
  const switchOn = (entry: V0810Row | undefined) =>
    entry === undefined
      ? undefined
      : v0810Truthy(entry["include401kInBonus"]) ||
        v0810Truthy(entry["includeBonusInContributions"]);
  const payrollJobOf = new Map<number, number>();
  for (const a of accounts) {
    const isPayroll =
      a["is_payroll_deducted"] === null ||
      a["is_payroll_deducted"] === undefined
        ? a["job_id"] !== null && a["job_id"] !== undefined
        : v0810Truthy(a["is_payroll_deducted"]);
    if (!isPayroll) continue;
    const jobId =
      a["job_id"] !== null && a["job_id"] !== undefined
        ? Number(a["job_id"])
        : Number(currentJob(Number(a["person_id"]))?.["id"]);
    if (Number.isFinite(jobId)) payrollJobOf.set(Number(a["id"]), jobId);
  }
  // Which Salary Profile's switch each Contribution Profile follows: the one
  // its Plans pair it with (when they all agree on one), else the active
  // one, else the oldest.
  const pairedSalary = (contributionProfileId: number) => {
    const ids = new Set(
      scenarios
        .filter(
          (plan) =>
            Number(plan["contribution_profile_id"]) === contributionProfileId,
        )
        .map((plan) => plan["salary_profile_id"])
        .filter((id) => id !== null && id !== undefined)
        .map(Number),
    );
    return ids.size === 1
      ? allSalaryProfiles.find((p) => Number(p["id"]) === [...ids][0])
      : undefined;
  };
  for (const cp of contributionProfiles) {
    const fields = v0810Object(cp["contribution_active_fields"]);
    const perAccount = v0810Object(fields?.["contributionAccounts"]);
    if (!fields || !perAccount) continue;
    const paired = pairedSalary(Number(cp["id"]));
    const ordered = [
      ...(paired ? [paired] : []),
      ...(activeSalary && activeSalary !== paired ? [activeSalary] : []),
      ...byId(salaryProfiles).filter((p) => p !== activeSalary && p !== paired),
    ];
    let changed = false;
    for (const [accountId, jobId] of payrollJobOf) {
      const entry = v0810Object(perAccount[String(accountId)]);
      if (!entry) continue;
      const sources = ordered
        .map((p) => ({ p, on: switchOn(salariesOf.get(p)![String(jobId)]) }))
        .filter((v): v is { p: V0810Row; on: boolean } => v.on !== undefined);
      const first = sources[0];
      if (!first) continue;
      if (sources.some((v) => v.on !== first.on))
        result.notes.push(
          `Contribution Profile ${cp["id"]}, account ${accountId}: Salary Profiles disagreed on taking contributions from bonus checks; used ${first.on ? "yes" : "no"} from Salary Profile "${String(first.p["name"])}"`,
        );
      if (!first.on || entry["fromBonus"] === true) continue;
      perAccount[String(accountId)] = { ...entry, fromBonus: true };
      changed = true;
    }
    if (!changed) continue;
    cp["contribution_active_fields"] = {
      ...fields,
      contributionAccounts: perAccount,
    };
    result.changed.contribution_profiles.add(Number(cp["id"]));
  }
  for (const p of allSalaryProfiles) {
    for (const entry of Object.values(salariesOf.get(p)!)) {
      if (
        "include401kInBonus" in entry ||
        "includeBonusInContributions" in entry
      ) {
        delete entry["include401kInBonus"];
        delete entry["includeBonusInContributions"];
        if (!result.newSalaryProfiles.includes(p))
          result.changed.salary_profiles.add(Number(p["id"]));
      }
    }
  }
  for (const p of salaryProfiles)
    if (result.changed.salary_profiles.has(Number(p["id"])))
      p["salaries"] = salariesOf.get(p);

  // Budget columns no longer have profiles of their own (0009 drops them):
  // note each Budget profile whose columns had one.
  for (const bp of tables["budget_profiles"] ?? []) {
    const ids = [
      v0810Json(bp["column_contribution_profile_ids"]),
      v0810Json(bp["column_salary_profile_ids"]),
    ].flatMap((v) => (Array.isArray(v) ? v : []));
    if (ids.some((id) => id !== null && id !== undefined))
      result.notes.push(
        `Budget profile ${bp["id"]}: its columns' own profiles are gone; every column now uses the active Salary and Contribution profiles`,
      );
  }

  // 4. Unique Plan names.
  // A new name must be free of every Plan's name, not just the ones before.
  const allPlanNames = new Set(scenarios.map((p) => String(p["name"])));
  const takenPlanNames = new Set<string>();
  for (const plan of byId(scenarios)) {
    const base = String(plan["name"]);
    let name = base;
    if (takenPlanNames.has(name)) {
      let n = 2;
      while (
        takenPlanNames.has(`${base} (${n})`) ||
        allPlanNames.has(`${base} (${n})`)
      )
        n++;
      name = `${base} (${n})`;
    }
    if (name !== base) {
      plan["name"] = name;
      result.changed.scenarios.add(Number(plan["id"]));
      result.notes.push(`Plan ${plan["id"]}: renamed to "${name}"`);
    }
    takenPlanNames.add(name);
  }
  return result;
}
