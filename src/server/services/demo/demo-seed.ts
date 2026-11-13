import { BLANK_SALARY_ENTRY } from "@/lib/db/shapes/salary-entry-defaults";
import type { DemoProfile } from "@/lib/demo";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db";
import { getParentCategory } from "@/lib/config/account-types";
import { accountMatchColumns } from "@/lib/pure/contributions/match-writes";
import type { AccountCategory } from "@/lib/config/account-types";
import {
  SK_ACTIVE_CONTRIB_PROFILE_ID,
  SK_ACTIVE_SALARY_PROFILE_ID,
} from "@/lib/constants/settings-keys";
import { speculativeJobValues } from "@/server/data/jobs";
import type { SalaryEntry } from "@/lib/db/shapes/salary-entry-defaults";
import { adoptFirstRetirementProfile } from "@/server/services/profiles/first-retirement-profile";
import { NEW_HOUSEHOLD_ROW } from "@/server/services/profiles/retirement-settings-row";
import type { RetirementSettingsInsert } from "@/server/services/profiles/retirement-settings-row";

/** Seed a demo profile into the given database connection (already on the demo schema). */
export async function seedProfile(
  db: DbOrTx,
  profile: DemoProfile,
  seededOn: Date,
) {
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

  // Every person gets the speculative-job peg real people get.
  await db
    .insert(schema.jobs)
    .values(personRows.map((p) => speculativeJobValues(p.id, seededOn)));

  // 2. Jobs: insert the structural job row, then collect a complete Salary
  // Profile entry (all 17 fields) for the demo Salary Profile below; a
  // profile entry is all-or-nothing, never partial.
  const salaryPinsByJobId: Record<string, SalaryEntry> = {};
  const jobIdByEmployer = new Map<string, number>();
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
    jobIdByEmployer.set(j.employerName, createdJob.id);
    // The persona's own figures over the blank entry (the fields no demo
    // persona models: extra withholding, box 2c, extra-paycheck routing…).
    salaryPinsByJobId[String(createdJob.id)] = {
      ...BLANK_SALARY_ENTRY,
      salary: Number(j.annualSalary),
      bonusPercent: Number(j.bonusPercent),
      payPeriod: j.payPeriod,
      payWeek: j.payWeek,
      anchorPayDate: j.anchorPayDate ?? null,
      w4FilingStatus: j.w4FilingStatus,
      bonusMonth: j.bonusMonth,
      bonusDayOfMonth: j.bonusDayOfMonth ?? null,
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

  // Savings funding is per (goal, budget profile): the fixture's one
  // monthlyContribution/allocationPercent per goal goes to every profile.
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

  // 8. Contribution accounts carry no value of their own: insert them, then
  // seed a demo Contribution Profile whose active fields cover every one (or
  // it renders $0/incomplete), and make it the active profile.
  const contributionActiveFieldsByAccountId: Record<
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
        jobId: ca.employerName
          ? (jobIdByEmployer.get(ca.employerName) ?? null)
          : null,
        personId: personIdByName.get(ca.personName)!,
        accountType: ca.accountType,
        parentCategory:
          ca.parentCategory ??
          getParentCategory(ca.accountType as AccountCategory),
        taxTreatment: ca.taxTreatment as "pre_tax",
        employerMatchType: ca.employerMatchType as "none",
        employerMatchValue: ca.employerMatchValue,
        // The rate, through the one writer (the demo seed is its only input).
        ...accountMatchColumns(ca.employerMatchType, ca, null),
        employerMaxMatchPct: ca.employerMaxMatchPct,
        performanceAccountId: perfId,
        hsaCoverageType: ca.hsaCoverageType ?? null,
      })
      .returning({ id: schema.contributionAccounts.id });
    if (created) {
      contributionActiveFieldsByAccountId[String(created.id)] = {
        contributionValue: ca.contributionValue,
        contributionMethod: ca.contributionMethod,
      };
    }
  }
  if (Object.keys(contributionActiveFieldsByAccountId).length > 0) {
    const [demoContributionProfile] = await db
      .insert(schema.contributionProfiles)
      .values({
        name: "Demo Contribution",
        contributionActiveFields: {
          contributionAccounts: contributionActiveFieldsByAccountId,
        },
      })
      .returning({ id: schema.contributionProfiles.id });
    if (demoContributionProfile) {
      await db.insert(schema.appSettings).values({
        key: SK_ACTIVE_CONTRIB_PROFILE_ID,
        value: demoContributionProfile.id,
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

  // 12. Retirement settings, a new household's (NEW_HOUSEHOLD_ROW).
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
    ...NEW_HOUSEHOLD_ROW,
  } satisfies RetirementSettingsInsert);
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
          ...NEW_HOUSEHOLD_ROW,
        } satisfies RetirementSettingsInsert);
      }
    }
  }

  // 12c. The first Retirement profile, as a real install gets it.
  await adoptFirstRetirementProfile(db);

  // 13. Return rate table
  for (const rr of profile.returnRates) {
    await db.insert(schema.returnRateTable).values({
      age: rr.age,
      rateOfReturn: rr.rateOfReturn,
    });
  }

  // Debts besides the mortgage
  for (const d of profile.debts) {
    await db.insert(schema.debts).values({
      name: d.name,
      kind: d.kind,
      ownerPersonId: d.ownerPersonName
        ? (personIdByName.get(d.ownerPersonName) ?? null)
        : null,
      balance: d.balance,
      balanceAsOf: d.balanceAsOf,
      interestRate: d.interestRate,
      monthlyPayment: d.monthlyPayment,
      originalAmount: d.originalAmount,
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
  // These three guard the DEMO_PROFILES fixture's own consistency — a
  // malformed constant is a dev bug, not a user error. Left as plain Error.
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
  const loanIdByName = new Map<string, number>();
  for (const _ml of profile.mortgageLoans) {
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
