/** Demo router for creating, listing, activating, and destroying isolated demo schemas seeded with predefined financial profiles. */
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { DEMO_PROFILES, getDemoProfileList } from "@/lib/demo";
import type { DemoProfile } from "@/lib/demo";
import * as schema from "@/lib/db/schema";
import { db as appDb, pool } from "@/lib/db";
import { isPostgres } from "@/lib/db/dialect";
import { getParentCategory } from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";
import {
  SK_ACTIVE_CONTRIB_PROFILE_ID,
  SK_ACTIVE_SALARY_PROFILE_ID,
} from "@/lib/constants/settings-keys";
import { speculativeJobValues } from "./settings/paycheck";
import type { W4FilingStatus } from "@/lib/config/enum-values";
import type { SalaryProfileEntry } from "../helpers/salary";
import { SK_ACTIVE_RETIREMENT_PROFILE_ID } from "@/lib/constants/settings-keys";

/** Safe slug pattern — lowercase alphanumeric + hyphens, 1-40 chars. */
const DEMO_SLUG_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
const MAX_SLUG_LENGTH = 40;

const demoSlugSchema = z
  .string()
  .min(1)
  .max(MAX_SLUG_LENGTH)
  .regex(
    DEMO_SLUG_REGEX,
    "Slug must be lowercase alphanumeric with hyphens only",
  );

/**
 * Escape a SQL identifier (schema/table/sequence name) to prevent injection.
 * Double-quotes the name and escapes any embedded double-quotes.
 */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Maximum number of demo schemas allowed (DoS prevention). */
const MAX_DEMO_SCHEMAS = 10;

/** Seed a demo profile into the given database connection (already on the demo schema). */
async function seedProfile(db: typeof appDb, profile: DemoProfile) {
  // 1. People
  const personRows = await db
    .insert(schema.people)
    .values(
      profile.people.map((p) => ({
        name: p.name,
        dateOfBirth: p.dateOfBirth,
        isPrimaryUser: p.isPrimaryUser,
      })),
    )
    .returning();
  const personIdByName = new Map(personRows.map((r) => [r.name, r.id]));

  // For parity with real usage — every person gets the same auto-provisioned
  // speculative-job peg settings.people.create gives real people.
  await db
    .insert(schema.jobs)
    .values(personRows.map((p) => speculativeJobValues(p.id)));

  // 2. Jobs — a job carries no salary/bonus/payroll terms of its own;
  // insert the (now purely structural) job row, then collect a COMPLETE
  // Salary Profile entry (all 17 fields — salary, bonus terms, the
  // payroll-config fields that used to live on the job row, and
  // extraPaycheckRouting) to give it in
  // a demo Salary Profile below — a profile entry is all-or-nothing, never
  // a partial pin (mirrors the "Demo Contribution" profile pattern).
  const salaryPinsByJobId: Record<string, SalaryProfileEntry> = {};
  for (const j of profile.jobs) {
    const [createdJob] = await db
      .insert(schema.jobs)
      .values({
        personId: personIdByName.get(j.personName)!,
        employerName: j.employerName,
        title: j.title,
        startDate: j.startDate,
        endDate: j.endDate,
      })
      .returning({ id: schema.jobs.id });
    if (!createdJob) continue;
    salaryPinsByJobId[String(createdJob.id)] = {
      salary: Number(j.annualSalary),
      bonusPercent: Number(j.bonusPercent),
      bonusMultiplier: 1,
      monthsInBonusYear: 12,
      bonusOverride: null,
      payPeriod: j.payPeriod,
      payWeek: j.payWeek,
      anchorPayDate: j.anchorPayDate ?? null,
      // Not modeled by DemoProfile.jobs — null defers to the payPeriod's
      // standard periods/month, same as an unset real Salary Profile entry.
      budgetPeriodsPerMonth: null,
      w4FilingStatus: j.w4FilingStatus,
      // Reasonable demo defaults — no demo persona needs box 2c checked or
      // extra withholding to look realistic.
      w4Box2cChecked: false,
      additionalFedWithholding: 0,
      bonusMonth: j.bonusMonth,
      bonusDayOfMonth: j.bonusDayOfMonth ?? null,
      // Matches speculativeJobValues' defaults for the same two flags.
      include401kInBonus: false,
      includeBonusInContributions: false,
      // Not modeled by DemoProfile.jobs — no demo persona needs a
      // preconfigured extra-paycheck routing to look realistic.
      extraPaycheckRouting: null,
    };
  }
  if (Object.keys(salaryPinsByJobId).length > 0) {
    const [demoSalaryProfile] = await db
      .insert(schema.salaryProfiles)
      .values({
        name: "Demo Salary",
        salaries: salaryPinsByJobId,
      })
      .returning({ id: schema.salaryProfiles.id });
    if (demoSalaryProfile) {
      await db.insert(schema.appSettings).values({
        key: SK_ACTIVE_SALARY_PROFILE_ID,
        value: demoSalaryProfile.id,
      });
    }
  }

  // 3. Budget profiles
  const profileRows = await db
    .insert(schema.budgetProfiles)
    .values(
      profile.budgetProfiles.map((bp) => ({
        name: bp.name,
        isActive: bp.isActive,
        columnLabels: bp.columnLabels,
        columnMonths: bp.columnMonths,
      })),
    )
    .returning();
  const profileIdByName = new Map(profileRows.map((r) => [r.name, r.id]));

  // 4. Budget items
  for (const bi of profile.budgetItems) {
    await db.insert(schema.budgetItems).values({
      profileId: profileIdByName.get(bi.profileName)!,
      category: bi.category,
      subcategory: bi.subcategory,
      isEssential: bi.isEssential,
      amounts: bi.amounts,
    });
  }

  // 5. Savings goals
  const goalRows = await db
    .insert(schema.savingsGoals)
    .values(
      profile.savingsGoals.map((sg) => ({
        name: sg.name,
        targetAmount: sg.targetAmount,
        targetMonths: sg.targetMonths,
        priority: sg.priority,
        isEmergencyFund: sg.isEmergencyFund,
      })),
    )
    .returning();
  const goalIdByName = new Map(goalRows.map((r) => [r.name, r.id]));

  // Savings funding is per-(goal, budget profile) with no shared default —
  // the demo fixture only defines one monthlyContribution/allocationPercent
  // per goal, so apply it to every demo budget profile (closest match to
  // pre-redesign behavior, where every profile read the same shared value
  // until customized).
  if (profileRows.length > 0) {
    await db.insert(schema.savingsGoalProfileAllocations).values(
      profile.savingsGoals.flatMap((sg) =>
        profileRows.map((pr) => ({
          goalId: goalIdByName.get(sg.name)!,
          budgetProfileId: pr.id,
          allocationPercent: sg.allocationPercent,
          monthlyContribution: sg.monthlyContribution,
        })),
      ),
    );
  }

  // 6. Savings monthly
  for (const sm of profile.savingsMonthly) {
    await db.insert(schema.savingsMonthly).values({
      goalId: goalIdByName.get(sm.goalName)!,
      monthDate: sm.monthDate,
      balance: sm.balance,
    });
  }

  // 7. Performance accounts (before contribution accounts and portfolio accounts, since they may reference these)
  const perfRows = await db
    .insert(schema.performanceAccounts)
    .values(
      profile.performanceAccounts.map((pa) => ({
        institution: pa.institution,
        accountType: pa.accountType,
        accountLabel: pa.accountLabel,
        ownershipType: pa.ownershipType,
        parentCategory: pa.parentCategory,
        label: pa.label,
        isActive: pa.isActive,
      })),
    )
    .returning();
  const _perfIdByLabel = new Map(perfRows.map((r) => [r.accountLabel, r.id]));

  // 8. Contribution accounts — accounts carry no value of their own, so
  // every demo account needs an explicit Contribution Profile active-field
  // entry or it would render as $0/incomplete. Insert the accounts first
  // (capturing their real ids), then seed one demo Contribution Profile
  // whose active fields cover all of them, and make it the active profile.
  const contribActiveFieldsByAccountId: Record<
    string,
    { contributionValue: string; contributionMethod: string }
  > = {};
  for (const ca of profile.contributionAccounts) {
    const perfId = ca.perfAccountLabel
      ? (_perfIdByLabel.get(ca.perfAccountLabel) ?? null)
      : null;
    const [created] = await db
      .insert(schema.contributionAccounts)
      .values({
        personId: personIdByName.get(ca.personName)!,
        accountType: ca.accountType,
        parentCategory:
          ca.parentCategory ??
          getParentCategory(ca.accountType as AccountCategory),
        taxTreatment: ca.taxTreatment as "pre_tax",
        employerMatchType: ca.employerMatchType as "none",
        employerMatchValue: ca.employerMatchValue,
        employerMaxMatchPct: ca.employerMaxMatchPct,
        performanceAccountId: perfId,
      })
      .returning({ id: schema.contributionAccounts.id });
    if (created) {
      contribActiveFieldsByAccountId[String(created.id)] = {
        contributionValue: ca.contributionValue,
        contributionMethod: ca.contributionMethod,
      };
    }
  }
  if (Object.keys(contribActiveFieldsByAccountId).length > 0) {
    const [demoContribProfile] = await db
      .insert(schema.contributionProfiles)
      .values({
        name: "Demo Contribution",
        contributionActiveFields: {
          contributionAccounts: contribActiveFieldsByAccountId,
        },
      })
      .returning({ id: schema.contributionProfiles.id });
    if (demoContribProfile) {
      await db.insert(schema.appSettings).values({
        key: SK_ACTIVE_CONTRIB_PROFILE_ID,
        value: demoContribProfile.id,
      });
    }
  }

  // 9. Portfolio snapshots
  const snapRows = await db
    .insert(schema.portfolioSnapshots)
    .values(
      profile.portfolioSnapshots.map((ps) => ({
        snapshotDate: ps.snapshotDate,
      })),
    )
    .returning();
  const snapshotId = snapRows[0]?.id;

  // 10. Portfolio accounts
  if (snapshotId) {
    for (const pa of profile.portfolioAccounts) {
      const perfId = pa.perfAccountLabel
        ? (_perfIdByLabel.get(pa.perfAccountLabel) ?? null)
        : null;
      await db.insert(schema.portfolioAccounts).values({
        snapshotId,
        institution: pa.institution,
        accountType: pa.accountType,
        parentCategory:
          pa.parentCategory ??
          getParentCategory(pa.accountType as AccountCategory),
        taxType: pa.taxType,
        amount: pa.amount,
        label: pa.label,
        ownerPersonId: pa.ownerPersonName
          ? (personIdByName.get(pa.ownerPersonName) ?? null)
          : null,
        performanceAccountId: perfId,
      });
    }
  }

  // 11. Annual performance
  for (const ap of profile.annualPerformance) {
    await db.insert(schema.annualPerformance).values({
      year: ap.year,
      category: ap.category,
      beginningBalance: ap.beginningBalance,
      totalContributions: ap.totalContributions,
      yearlyGainLoss: ap.yearlyGainLoss,
      endingBalance: ap.endingBalance,
      annualReturnPct: ap.annualReturnPct,
      employerContributions: ap.employerContributions,
      fees: ap.fees,
      lifetimeGains: ap.lifetimeGains,
      lifetimeContributions: ap.lifetimeContributions,
      lifetimeMatch: ap.lifetimeMatch,
    });
  }

  // 12. Retirement settings — filing_status is NOT NULL on the DB row (see
  // drizzle/0021); derive it from that person's own job the same way the
  // migration's backfill does, since the demo seeder writes directly to
  // the DB rather than through retirement.retirementSettings.upsert.
  const filingStatusByPersonName = (personName: string): W4FilingStatus =>
    profile.jobs.find((j) => j.personName === personName)?.w4FilingStatus ??
    "MFJ";
  const rs = profile.retirementSettings;
  const personId = personIdByName.get(rs.personName)!;
  await db.insert(schema.retirementSettings).values({
    personId,
    retirementAge: rs.retirementAge,
    endAge: rs.endAge,
    returnAfterRetirement: rs.returnAfterRetirement,
    annualInflation: rs.annualInflation,
    salaryAnnualIncrease: rs.salaryAnnualIncrease,
    withdrawalRate: rs.withdrawalRate,
    withdrawalStrategy: rs.withdrawalStrategy,
    socialSecurityMonthly: rs.socialSecurityMonthly,
    ssStartAge: rs.ssStartAge,
    filingStatus: filingStatusByPersonName(rs.personName),
  });
  // Tracks each person's real retirement-age/end-age/SS figures for step
  // 12c's retirement_profile_people backfill below — mirrors what was
  // actually inserted into retirement_settings for each person.
  const retirementFieldsByPersonId = new Map([[personId, rs]] as [
    number,
    {
      retirementAge: number;
      endAge: number;
      socialSecurityMonthly: string | null;
      ssStartAge: number | null;
    },
  ][]);

  // 12b. Per-person retirement settings overrides
  if (profile.perPersonRetirementSettings) {
    for (const prs of profile.perPersonRetirementSettings) {
      const prsPersonId = personIdByName.get(prs.personName);
      if (prsPersonId && prsPersonId !== personId) {
        await db.insert(schema.retirementSettings).values({
          personId: prsPersonId,
          retirementAge: prs.retirementAge ?? rs.retirementAge,
          endAge: prs.endAge ?? rs.endAge,
          returnAfterRetirement: rs.returnAfterRetirement,
          annualInflation: rs.annualInflation,
          salaryAnnualIncrease: rs.salaryAnnualIncrease,
          withdrawalRate: prs.withdrawalRate ?? rs.withdrawalRate,
          withdrawalStrategy: rs.withdrawalStrategy,
          socialSecurityMonthly: prs.socialSecurityMonthly,
          ssStartAge: prs.ssStartAge,
          filingStatus: filingStatusByPersonName(prs.personName),
        });
        retirementFieldsByPersonId.set(prsPersonId, {
          retirementAge: prs.retirementAge ?? rs.retirementAge,
          endAge: prs.endAge ?? rs.endAge,
          socialSecurityMonthly: prs.socialSecurityMonthly,
          ssStartAge: prs.ssStartAge,
        });
      }
    }
  }

  // 12c. Retirement Profiles backfill — mirrors migration
  // 0032_curved_silhouette.sql's own backfill (advisor-caught 2026-09-01:
  // this seeder used to insert retirement_settings rows directly with no
  // profile_id at all and never created a retirement_profiles row,
  // leaving the Retirement Profile Manager sidebar permanently empty for
  // any demo household — retirementProfiles.duplicate is the only
  // creation path and needs an existing profile to clone FROM, so there
  // was no in-app way to recover). One "Current Plan" profile, every
  // retirement_settings row pointed at it, one retirement_profile_people
  // row per person (falling back to the primary person's figures for
  // anyone without their own retirement_settings row, same rule the real
  // migration's backfill uses), and the active-profile app_setting so the
  // Retirement page doesn't render blank.
  const [retirementProfile] = await db
    .insert(schema.retirementProfiles)
    .values({
      name: "Current Plan",
      description:
        "Your existing retirement assumptions, carried over when Retirement Profiles were introduced.",
    })
    .returning({ id: schema.retirementProfiles.id });
  await db
    .update(schema.retirementSettings)
    .set({ profileId: retirementProfile!.id });
  for (const pId of personIdByName.values()) {
    const fields = retirementFieldsByPersonId.get(pId) ?? rs;
    await db.insert(schema.retirementProfilePeople).values({
      profileId: retirementProfile!.id,
      personId: pId,
      retirementAge: fields.retirementAge,
      endAge: fields.endAge,
      socialSecurityMonthly: fields.socialSecurityMonthly,
      ssStartAge: fields.ssStartAge,
    });
  }
  await db.insert(schema.appSettings).values({
    key: SK_ACTIVE_RETIREMENT_PROFILE_ID,
    value: retirementProfile!.id,
  });

  // 13. Return rate table
  for (const rr of profile.returnRates) {
    await db.insert(schema.returnRateTable).values({
      age: rr.age,
      rateOfReturn: rr.rateOfReturn,
    });
  }

  // 14. Mortgage loans
  for (const ml of profile.mortgageLoans) {
    await db.insert(schema.mortgageLoans).values({
      name: ml.name,
      isActive: ml.isActive,
      principalAndInterest: ml.principalAndInterest,
      interestRate: ml.interestRate,
      termYears: ml.termYears,
      originalLoanAmount: ml.originalLoanAmount,
      firstPaymentDate: ml.firstPaymentDate,
      propertyValuePurchase: ml.propertyValuePurchase,
      propertyValueEstimated: ml.propertyValueEstimated,
    });
  }

  // 15. Account performance (per-account yearly breakdown)
  // Build a lookup from accountLabel → perfAccount.id for FK linking
  for (const ap of profile.accountPerformance) {
    if (!ap.perfAccountLabel) {
      throw new Error(
        `demo profile: accountPerformance ${ap.institution}/${ap.accountLabel} (year ${ap.year}) missing perfAccountLabel`,
      );
    }
    const perfId = _perfIdByLabel.get(ap.perfAccountLabel);
    if (perfId == null) {
      throw new Error(
        `demo profile: perfAccountLabel="${ap.perfAccountLabel}" not found in seeded performance_accounts`,
      );
    }
    const master = perfRows.find((p) => p.id === perfId);
    if (!master) {
      throw new Error(
        `demo profile: performance_account id=${perfId} not found`,
      );
    }
    await db.insert(schema.accountPerformance).values({
      year: ap.year,
      institution: ap.institution,
      accountLabel: ap.accountLabel,
      ownerPersonId: ap.ownerPersonName
        ? (personIdByName.get(ap.ownerPersonName) ?? null)
        : null,
      beginningBalance: ap.beginningBalance,
      totalContributions: ap.totalContributions,
      yearlyGainLoss: ap.yearlyGainLoss,
      endingBalance: ap.endingBalance,
      annualReturnPct: ap.annualReturnPct,
      employerContributions: ap.employerContributions,
      fees: ap.fees,
      parentCategory: master.parentCategory,
      performanceAccountId: perfId,
    });
  }

  // 16. Other asset items
  for (const oa of profile.otherAssetItems) {
    await db.insert(schema.otherAssetItems).values({
      name: oa.name,
      year: oa.year,
      value: oa.value,
      note: oa.note,
    });
  }

  // 17. Property taxes
  // Build loan name → id map
  const loanIdByName = new Map<string, number>();
  for (const _ml of profile.mortgageLoans) {
    // Re-query to get IDs (loans were inserted above without RETURNING)
    const rows = await db
      .select({ id: schema.mortgageLoans.id, name: schema.mortgageLoans.name })
      .from(schema.mortgageLoans);
    for (const r of rows) loanIdByName.set(r.name, r.id);
    break; // Only need one query
  }
  for (const pt of profile.propertyTaxes) {
    const lid = loanIdByName.get(pt.loanName);
    if (!lid) continue;
    await db.insert(schema.propertyTaxes).values({
      loanId: lid,
      year: pt.year,
      assessedValue: pt.assessedValue,
      taxAmount: pt.taxAmount,
      note: pt.note,
    });
  }

  // 18. Home improvements
  for (const hi of profile.homeImprovements) {
    await db.insert(schema.homeImprovementItems).values({
      year: hi.year,
      description: hi.description,
      cost: hi.cost,
    });
  }

  // 19. Net worth annual
  for (const nw of profile.netWorthAnnual) {
    await db.insert(schema.netWorthAnnual).values({
      yearEndDate: nw.yearEndDate,
      grossIncome: nw.grossIncome,
      combinedAgi: nw.combinedAgi,
      cash: nw.cash,
      houseValue: nw.houseValue,
      retirementTotal: nw.retirementTotal,
      portfolioTotal: nw.portfolioTotal,
      mortgageBalance: nw.mortgageBalance,
      portfolioByTaxLocation: { retirement: {}, portfolio: {} },
    });
  }

  // 20. App settings
  for (const as_ of profile.appSettings) {
    await db.insert(schema.appSettings).values({
      key: as_.key,
      value: as_.value,
    });
  }
}

export const demoRouter = createTRPCRouter({
  /** List available demo profiles. */
  listProfiles: protectedProcedure.query(() => {
    return {
      profiles: getDemoProfileList(),
      isDemoOnly: process.env.DEMO_ONLY === "true",
    };
  }),

  /** Activate a demo profile — creates schema, seeds data, returns success.
   *  Uses protectedProcedure (not a domain procedure) intentionally: writes
   *  go to an isolated per-user demo schema, never to shared application
   *  data, and must remain callable in DEMO_ONLY mode. See RULES.md
   *  § Permission & Security Gates rule 3 exception. */
  activateProfile: protectedProcedure
    .input(z.object({ slug: demoSlugSchema }))
    .mutation(async ({ input }) => {
      if (!isPostgres()) {
        throw new Error(
          "Demo mode requires PostgreSQL (uses PG schemas for isolation)",
        );
      }

      const profile = DEMO_PROFILES[input.slug];
      if (!profile) {
        throw new Error(`Unknown demo profile: ${input.slug}`);
      }

      const schemaName = `demo_${input.slug.replace(/-/g, "_")}`;
      const quotedSchema = quoteIdent(schemaName);

      // Enforce max demo schema count to prevent DoS
      const client = await pool.connect();
      try {
        const schemaCount = await client.query(
          `SELECT count(*)::int AS cnt FROM information_schema.schemata WHERE schema_name LIKE 'demo_%'`,
        );
        if ((schemaCount.rows[0]?.cnt ?? 0) >= MAX_DEMO_SCHEMAS) {
          throw new Error(
            `Maximum demo schemas (${MAX_DEMO_SCHEMAS}) reached. Deactivate an existing profile first.`,
          );
        }

        const { drizzle } = await import("drizzle-orm/node-postgres");
        // eslint-disable-next-line no-restricted-syntax -- Drizzle ORM type limitation
        const cdb = drizzle(client, { schema }) as unknown as typeof appDb;

        // Create schema if not exists
        await cdb.execute(
          sql.raw(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`),
        );

        // Copy table structure from public schema into demo schema
        const tables = await cdb.execute<{ tablename: string }>(
          sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
        );

        for (const { tablename } of tables.rows) {
          const quotedTable = quoteIdent(tablename);
          await cdb.execute(
            sql.raw(
              `DROP TABLE IF EXISTS ${quotedSchema}.${quotedTable} CASCADE`,
            ),
          );
          await cdb.execute(
            sql.raw(
              `CREATE TABLE ${quotedSchema}.${quotedTable} (LIKE public.${quotedTable} INCLUDING ALL)`,
            ),
          );
        }

        // Copy sequences/serial defaults — reset all serial sequences
        const sequences = await cdb.execute<{ sequence_name: string }>(
          sql`SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'`,
        );
        for (const { sequence_name } of sequences.rows) {
          const quotedSeq = quoteIdent(sequence_name);
          await cdb.execute(
            sql.raw(
              `CREATE SEQUENCE IF NOT EXISTS ${quotedSchema}.${quotedSeq}`,
            ),
          );
          await cdb.execute(
            sql.raw(
              `ALTER SEQUENCE ${quotedSchema}.${quotedSeq} RESTART WITH 1`,
            ),
          );
        }

        // Switch search_path and seed demo data + reference tables
        await client.query(`SET search_path TO ${quotedSchema}, public`);

        // Copy reference/shared data that calculators depend on
        const refTables = ["contribution_limits", "tax_brackets"];
        for (const table of refTables) {
          const quotedTable = quoteIdent(table);
          await cdb.execute(
            sql.raw(
              `INSERT INTO ${quotedSchema}.${quotedTable} SELECT * FROM public.${quotedTable}`,
            ),
          );
        }

        await seedProfile(cdb, profile);
      } finally {
        await client.query("SET search_path TO public");
        client.release();
      }

      // Set HttpOnly cookie server-side so it's not accessible to JavaScript
      const cookieStore = await cookies();
      cookieStore.set("demo_active_profile", input.slug, {
        path: "/",
        maxAge: 86400,
        sameSite: "strict",
        httpOnly: true,
      });

      return { ok: true, slug: input.slug, schemaName };
    }),

  /** Deactivate demo mode — clear the HttpOnly cookie server-side.
   *  Uses protectedProcedure (not a domain procedure) intentionally: this
   *  mutates session/cookie state, not application data, and must remain
   *  callable in DEMO_ONLY mode where the demoOnlyGuard exempts demo.*
   *  paths. See RULES.md § Permission & Security Gates rule 3 exception. */
  deactivateDemo: protectedProcedure.mutation(async () => {
    const cookieStore = await cookies();
    cookieStore.set("demo_active_profile", "", {
      path: "/",
      maxAge: 0,
      httpOnly: true,
    });
    return { ok: true };
  }),

  /** Check if a demo schema exists and has data. */
  isDemoReady: protectedProcedure
    .input(z.object({ slug: demoSlugSchema }))
    .query(async ({ ctx, input }) => {
      if (!isPostgres()) {
        return { ready: false };
      }
      const schemaName = `demo_${input.slug.replace(/-/g, "_")}`;
      const result = await ctx.db.execute<{ exists: boolean }>(
        sql`SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name = ${schemaName}) as exists`,
      );
      return { ready: result.rows[0]?.exists ?? false };
    }),
});
