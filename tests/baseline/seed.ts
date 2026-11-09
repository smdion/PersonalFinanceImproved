/**
 * An invented household, and the seeder that writes it into a database
 * migrated from empty through the app's own tRPC write procedures, the way
 * a household fills a fresh install. Nothing is written to a table
 * directly, so the same calls seed SQLite and PostgreSQL.
 *
 * Ported from the November review's screens-e2e harness (`seed.mjs`,
 * `households.mjs`), which seeded four households over HTTP the same way.
 */
import type { inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers";
import type { SalaryEntry } from "@/lib/db/shapes/salary-entry-defaults";
import { BLANK_SALARY_ENTRY } from "@/lib/db/shapes/salary-entry-defaults";

type Inputs = inferRouterInputs<AppRouter>;
type ContribInput = Inputs["settings"]["contributionAccounts"]["create"];
type PerfInput = Inputs["performance"]["performanceAccounts"]["create"];
type SnapshotRow =
  Inputs["networth"]["portfolioSnapshots"]["create"]["accounts"][number];
type RetirementInput = Inputs["retirement"]["retirementSettings"]["upsert"];

/** The caller every baseline seeds and reads through (admin session). */
export type Caller = ReturnType<AppRouter["createCaller"]>;

export interface Household {
  /** Folder name under __baseline__/. */
  key: string;
  /** Where the household's shape comes from in the November review. */
  source: string;
  people: {
    key: string;
    name: string;
    dateOfBirth: string;
    isPrimaryUser: boolean;
  }[];
  /** Pay terms go in the active Salary Profile, as the app keeps them. */
  jobs: {
    key: string;
    person: string;
    employerName: string;
    startDate: string;
    entry: Partial<SalaryEntry>;
  }[];
  /** Per-check amounts go in the active Contribution Profile. */
  deductions: {
    job: string;
    deductionName: string;
    isPretax: boolean;
    ficaExempt: boolean;
    perPeriod: string;
  }[];
  /** A performance account, its rows in today's snapshot (one per part)
   *  and the contribution accounts that pay into it. */
  accounts: {
    key: string;
    perf: Omit<PerfInput, "ownerPersonId"> & { owner: string | null };
    snapshot: (Omit<
      SnapshotRow,
      "institution" | "accountType" | "ownerPersonId"
    > & {
      owner: string | null;
    })[];
    contrib: (Omit<
      ContribInput,
      "jobId" | "personId" | "performanceAccountId"
    > & {
      job: string | null;
      person: string | null;
      value: string;
      method: string;
    })[];
  }[];
  cash: number;
  mortgage?: Inputs["mortgage"]["mortgageLoans"]["create"];
  debts?: Inputs["debts"]["create"][];
  savingsGoals?: Inputs["savings"]["savingsGoals"]["create"][];
  /** Monthly budget, one column. */
  budget: {
    category: string;
    subcategory: string;
    monthly: number;
    essential: boolean;
  }[];
  /** Per person: retirement age, end age, Social Security. */
  retirement: Record<
    string,
    {
      retirementAge: number;
      endAge: number;
      ssMonthly: string;
      ssStartAge: number;
    }
  >;
  /** Household-wide retirement settings, written on every person's row. */
  settings: Omit<
    RetirementInput,
    | "personId"
    | "retirementAge"
    | "endAge"
    | "socialSecurityMonthly"
    | "ssStartAge"
  >;
  returnRates: [age: number, rate: string][];
}

/** Ids the seeder created, by the household's keys; procedures that take
 *  an id read them from here. */
export interface SeededIds {
  people: Record<string, number>;
  jobs: Record<string, number>;
  perf: Record<string, number>;
  contrib: number[];
  budgetProfile: number;
  salaryProfile: number;
  contributionProfile: number;
  mortgage: number | null;
}

/** The snapshot date every household's balances are dated. */
const SNAPSHOT_DATE = "2026-03-01";

function need<T>(value: T | undefined | null, what: string): T {
  if (value == null) throw new Error(`seed: no ${what}`);
  return value;
}

export async function seedHousehold(
  call: Caller,
  h: Household,
): Promise<SeededIds> {
  const people: Record<string, number> = {};
  for (const p of h.people) {
    const r = await call.settings.people.create({
      name: p.name,
      dateOfBirth: p.dateOfBirth,
      isPrimaryUser: p.isPrimaryUser,
    });
    people[p.key] = need(r, `person ${p.key}`).id;
  }
  const person = (key: string | null) =>
    key == null ? null : need(people[key], `person ${key}`);

  const jobs: Record<string, number> = {};
  for (const j of h.jobs) {
    const r = await call.settings.jobs.create({
      personId: need(person(j.person), j.person),
      employerName: j.employerName,
      startDate: j.startDate,
    });
    jobs[j.key] = need(r, `job ${j.key}`).id;
  }
  const job = (key: string | null) =>
    key == null ? null : need(jobs[key], `job ${key}`);

  const salaryProfile = need(
    (await call.salaryProfile.list())[0],
    "salary profile",
  ).id;
  if (h.jobs.length > 0) {
    const salaries: Record<string, SalaryEntry> = {};
    for (const j of h.jobs)
      salaries[String(job(j.key))] = { ...BLANK_SALARY_ENTRY, ...j.entry };
    await call.salaryProfile.update({ id: salaryProfile, salaries });
  }

  const deductions: Record<string, { amountPerPeriod: string }> = {};
  for (const d of h.deductions) {
    const r = await call.settings.deductions.create({
      jobId: need(job(d.job), d.job),
      deductionName: d.deductionName,
      isPretax: d.isPretax,
      ficaExempt: d.ficaExempt,
    });
    deductions[String(need(r, d.deductionName).id)] = {
      amountPerPeriod: d.perPeriod,
    };
  }

  const perf: Record<string, number> = {};
  const contrib: number[] = [];
  const contributionAccounts: Record<
    string,
    { contributionValue: string; contributionMethod: string; isActive: true }
  > = {};
  for (const a of h.accounts) {
    const { owner, ...perfInput } = a.perf;
    const created = await call.performance.performanceAccounts.create({
      ...perfInput,
      ownerPersonId: person(owner),
    });
    perf[a.key] = need(created, `account ${a.key}`).id;
    for (const c of a.contrib) {
      const { job: jobKey, person: personKey, value, method, ...rest } = c;
      const r = await call.settings.contributionAccounts.create({
        ...rest,
        jobId: job(jobKey),
        personId: person(personKey),
        performanceAccountId: perf[a.key],
      });
      const id = need(r, `contribution to ${a.key}`).id;
      contrib.push(id);
      contributionAccounts[String(id)] = {
        contributionValue: value,
        contributionMethod: method,
        isActive: true,
      };
    }
  }
  const contributionProfile = need(
    (await call.contributionProfile.list())[0],
    "contribution profile",
  ).id;
  await call.contributionProfile.update({
    id: contributionProfile,
    contributionActiveFields: { contributionAccounts, deductions },
  });

  const rows: SnapshotRow[] = h.accounts.flatMap((a) =>
    a.snapshot.map(({ owner, ...row }) => ({
      ...row,
      institution: a.perf.institution,
      accountType: a.perf.accountType,
      parentCategory: a.perf.parentCategory,
      ownerPersonId: person(owner),
      performanceAccountId: perf[a.key],
    })),
  );
  if (rows.length > 0)
    await call.networth.portfolioSnapshots.create({
      snapshotDate: SNAPSHOT_DATE,
      accounts: rows,
    });

  await call.settings.appSettings.upsert({
    key: "current_cash",
    value: h.cash,
  });
  const mortgage = h.mortgage
    ? need(await call.mortgage.mortgageLoans.create(h.mortgage), "mortgage").id
    : null;
  for (const d of h.debts ?? []) await call.debts.create(d);
  for (const g of h.savingsGoals ?? [])
    await call.savings.savingsGoals.create(g);

  await call.budget.createProfile({
    name: "Household budget",
    columnLabels: ["Standard"],
  });
  const budget = need(
    (await call.budget.listProfiles()).find(
      (p) => p.name === "Household budget",
    ),
    "budget profile",
  );
  if (!budget.isActive) await call.budget.setActiveProfile({ id: budget.id });
  // A new budget starts with the template's lines at $0: fill a line the
  // template has, add the others.
  const summary = await call.budget.computeActiveSummary({});
  const template = summary?.rawItems ?? [];
  for (const b of h.budget) {
    const existing = template.find(
      (i) => i.category === b.category && i.subcategory === b.subcategory,
    );
    const id =
      existing?.id ??
      need(
        await call.budget.createItem({
          category: b.category,
          subcategory: b.subcategory,
          isEssential: b.essential,
          profileId: budget.id,
        }),
        b.subcategory,
      ).id;
    await call.budget.updateItemAmount({ id, colIndex: 0, amount: b.monthly });
  }

  for (const p of h.people) {
    const r = need(h.retirement[p.key], `retirement for ${p.key}`);
    await call.retirement.retirementSettings.upsert({
      ...h.settings,
      personId: need(person(p.key), p.key),
      retirementAge: r.retirementAge,
      endAge: r.endAge,
      socialSecurityMonthly: r.ssMonthly,
      ssStartAge: r.ssStartAge,
    });
  }
  for (const [age, rate] of h.returnRates)
    await call.retirement.returnRates.upsert({ age, rateOfReturn: rate });
  await call.settings.completeOnboarding();

  return {
    people,
    jobs,
    perf,
    contrib,
    budgetProfile: budget.id,
    salaryProfile,
    contributionProfile,
    mortgage,
  };
}
