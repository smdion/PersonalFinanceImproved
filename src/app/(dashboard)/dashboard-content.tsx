"use client";

import { PageHeader } from "@/components/ui/page-header";
import { CardBoundary } from "@/components/dashboard/utils";
import { HouseholdIncomeCard } from "@/components/dashboard/household-income-card";
import { SavingsGoalsCard } from "@/components/dashboard/savings-goals-card";
import { RetirementCard } from "@/components/dashboard/retirement-card";
import { NetWorthCard } from "@/components/dashboard/net-worth-card";
import { LinkedBalanceCard } from "@/components/dashboard/linked-balance-card";
import { ContributionsCard } from "@/components/dashboard/contributions-card";
import { FinancialCheckupCard } from "@/components/dashboard/financial-checkup-card";
import { LivingCostsCard } from "@/components/dashboard/living-costs-card";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { trpc } from "@/lib/trpc";

/**
 * Dashboard client content: onboarding wizard, scenario context and each
 * Card's queries; page.tsx is the server component that prefetches.
 */
export function DashboardContent() {
  const utils = trpc.useUtils();
  const { data: onboarding } = trpc.settings.getOnboardingStatus.useQuery();

  return (
    <div>
      {onboarding && !onboarding.complete && (
        <OnboardingWizard onComplete={() => utils.settings.invalidate()} />
      )}
      <PageHeader title="Dashboard" subtitle="Financial overview" />

      {/* Primary metrics row */}
      <div className="mb-3 grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3">
        <CardBoundary title="Net Worth">
          <NetWorthCard />
        </CardBoundary>
        <CardBoundary title="Current Balances">
          <LinkedBalanceCard />
        </CardBoundary>
        <CardBoundary title="Household Income">
          <HouseholdIncomeCard />
        </CardBoundary>
        <CardBoundary title="Financial Checkup">
          <FinancialCheckupCard />
        </CardBoundary>
      </div>

      {/* This year's money: the goals savings fund, the budget and
          spending, and what's going into savings */}
      <div className="mb-3 grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] gap-3">
        <CardBoundary title="Savings Goals">
          <SavingsGoalsCard />
        </CardBoundary>
        <CardBoundary title="Budget & Spending">
          <LivingCostsCard />
        </CardBoundary>
        <CardBoundary title="Contributions">
          <ContributionsCard />
        </CardBoundary>
      </div>

      {/* Retirement outlook, with its benchmarks */}
      <div className="grid gap-3">
        <CardBoundary title="Retirement">
          <RetirementCard />
        </CardBoundary>
      </div>
    </div>
  );
}
