/**
 * The fresh-install cases, shared by the SQLite and PostgreSQL files: each
 * case starts from an empty database the real migrator (`db-migrate.ts`, as
 * a child process) has just set up, then goes through the app's procedures
 * the way a first run does. Each file supplies `fresh()` for its database.
 *
 * Imports only types from the app: the PostgreSQL file must point
 * DATABASE_URL at its database before the db module is first imported.
 */
import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import type { Session } from "next-auth";
import type { AppRouter } from "@/server/routers";
import { BLANK_SALARY_ENTRY } from "@/lib/db/salary-entry-defaults";
import {
  SK_ACTIVE_CONTRIB_PROFILE_ID,
  SK_ACTIVE_RETIREMENT_PROFILE_ID,
  SK_ACTIVE_SALARY_PROFILE_ID,
} from "@/lib/constants/settings-keys";

type Caller = ReturnType<AppRouter["createCaller"]>;

export interface FreshInstall {
  /** A caller on this database; `null` is a signed-out visitor. */
  caller: (session: Session | null) => Caller;
  /** Row count of one table. */
  count: (table: string) => Promise<number>;
}

/** The signed-in first admin. */
export const firstAdminSession: Session = {
  user: {
    id: "fresh-install-admin",
    name: "First Admin",
    email: "admin@fresh.local",
    role: "admin",
    permissions: [],
  },
  expires: "2099-12-31T23:59:59.999Z",
};

/** Tax and contribution-limit tables the migrator fills from `tax-data/`. */
const TAX_TABLES = [
  "contribution_limits",
  "tax_brackets",
  "ltcg_brackets",
  "irmaa_brackets",
  "fpl_by_household",
  "tax_params",
];

/** Simulation presets and the asset classes they draw from. */
const PRESET_TABLES = [
  "mc_presets",
  "mc_preset_glide_paths",
  "mc_preset_return_overrides",
  "asset_class_params",
  "asset_class_correlations",
  "asset_class_buckets",
];

const TSX = path.join(process.cwd(), "node_modules", ".bin", "tsx");

/**
 * Run `tsx db-migrate.ts` with `env` (SQLITE_PATH or DATABASE_URL) and
 * throw with its output unless it exits 0. The child doesn't inherit the
 * runner's VITEST variables: db-migrate.ts does nothing when VITEST is set.
 */
export function runMigrator(env: Record<string, string> = {}): void {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
  for (const key of Object.keys(childEnv))
    if (key.startsWith("VITEST")) delete childEnv[key];
  const result = spawnSync(TSX, ["db-migrate.ts"], {
    cwd: process.cwd(),
    env: childEnv,
    encoding: "utf8",
    timeout: 180_000,
  });
  if (result.status !== 0)
    throw new Error(
      `db-migrate.ts exited ${result.status}:\n${result.stderr}\n${result.stdout}`,
    );
}

/** The wizard's steps (createLocalAdmin, then Finish), then saving the
 *  Retirement settings. Returns the household's one person. */
async function firstRun(install: FreshInstall): Promise<number> {
  await install.caller(null).settings.createLocalAdmin({
    name: "First Admin",
    email: "admin@fresh.local",
    password: "Fresh-install-pass-1",
  });
  const admin = install.caller(firstAdminSession);
  const person = await admin.settings.people.create({
    name: "Robin",
    dateOfBirth: "1985-06-15",
    isPrimaryUser: true,
  });
  const job = await admin.settings.jobs.create({
    personId: person!.id,
    employerName: "Employer",
    startDate: "2026-01-05",
  });
  const [baseline] = await admin.salaryProfile.list();
  await admin.salaryProfile.update({
    id: baseline!.id,
    salaries: {
      ...baseline!.salaries,
      [String(job!.id)]: { ...BLANK_SALARY_ENTRY, salary: 90_000 },
    },
  });
  await admin.settings.completeOnboarding();
  await admin.retirement.retirementSettings.upsert({
    personId: person!.id,
    retirementAge: 65,
    endAge: 95,
    returnAfterRetirement: "0.05",
    annualInflation: "0.025",
    salaryAnnualIncrease: "0.03",
  });
  return person!.id;
}

/** Register every case. `fresh` returns a newly migrated empty database. */
export function freshInstallCases(fresh: () => Promise<FreshInstall>): void {
  const timeout = 180_000;

  it(
    "migrates an empty database and fills the tax tables",
    async () => {
      const install = await fresh();
      for (const table of TAX_TABLES)
        expect(await install.count(table), table).toBeGreaterThan(0);
    },
    timeout,
  );

  it(
    "fills the simulation preset tables",
    async () => {
      const install = await fresh();
      for (const table of PRESET_TABLES)
        expect(await install.count(table), table).toBeGreaterThan(0);
    },
    timeout,
  );

  it.fails(
    "simulated Coast FIRE runs instead of returning unreachable for lack of a preset",
    async () => {
      const install = await fresh();
      await firstRun(install);
      const { result } = await install
        .caller(firstAdminSession)
        .projection.computeCoastFireMC({});
      expect(result).not.toBeNull();
      expect(result!.probesRun, result!.warning ?? "").toBeGreaterThan(0);
    },
    timeout,
  );

  it.fails(
    "first-run state says an admin is needed when there is none",
    async () => {
      const settings = (await fresh()).caller(null).settings;
      // @ts-expect-error -- settings.firstRunState doesn't exist yet
      const state: unknown = await settings.firstRunState();
      expect(state).toMatchObject({ adminNeeded: true });
    },
    timeout,
  );

  it.fails(
    "first run (admin, onboarding, retirement settings) leaves a Retirement profile",
    async () => {
      const install = await fresh();
      const personId = await firstRun(install);
      const admin = install.caller(firstAdminSession);
      const profiles = await admin.retirement.retirementProfiles.list();
      expect(profiles).toHaveLength(1);
      const rows = await admin.retirement.retirementSettings.list();
      expect(rows.find((r) => r.personId === personId)?.profileId).toBe(
        profiles[0]!.id,
      );
    },
    timeout,
  );

  it.fails(
    "after the first run and a budget profile, the active profiles save as a Plan",
    async () => {
      const install = await fresh();
      await firstRun(install);
      const admin = install.caller(firstAdminSession);
      const budget = await admin.budget.createProfile({ name: "Household" });
      await admin.budget.setActiveProfile({ id: budget.id });

      // The active profile of each kind, as the Plans bar reads them.
      const settings = await admin.settings.appSettings.list();
      const active = (key: string) => {
        const value = settings.find((s) => s.key === key)?.value;
        return value == null ? undefined : Number(value);
      };
      const [firstRetirement] =
        await admin.retirement.retirementProfiles.list();
      const ids = {
        salaryProfileId: active(SK_ACTIVE_SALARY_PROFILE_ID),
        contributionProfileId: active(SK_ACTIVE_CONTRIB_PROFILE_ID),
        budgetProfileId: budget.id,
        retirementProfileId:
          active(SK_ACTIVE_RETIREMENT_PROFILE_ID) ?? firstRetirement?.id,
      };
      for (const [kind, id] of Object.entries(ids))
        expect(id, kind).toEqual(expect.any(Number));

      const plan = await admin.settings.scenarios.create({
        name: "Current",
        salaryProfileId: ids.salaryProfileId!,
        contributionProfileId: ids.contributionProfileId!,
        budgetProfileId: ids.budgetProfileId,
        retirementProfileId: ids.retirementProfileId!,
      });
      expect(plan).toMatchObject({ name: "Current", ...ids });
    },
    timeout,
  );
}
