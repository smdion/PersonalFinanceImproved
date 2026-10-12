"use client";

import { PageHeader } from "@/components/ui/page-header";
import { CardBoundary } from "@/components/cards/dashboard/utils";
import {
  HouseholdIncomeCard,
  SavingsGoalsCard,
  RetirementCard,
  NetWorthCard,
  LinkedBalanceCard,
  ContributionsCard,
  FinancialCheckupCard,
  LivingCostsCard,
} from "@/components/cards/dashboard";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { trpc } from "@/lib/trpc";

/**
 * Dashboard content — extracted from page.tsx so the page can be a
 * server component that pre-fetches the most expensive queries. This
 * file owns the client interactivity:
 * onboarding wizard, scenario context consumption, useQuery hooks
 * inside each Card.
 */
export function DashboardContent() {
  const utils = trpc.useUtils();
  const { data: onboarding } = trpc.settings.isOnboardingComplete.useQuery();

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
        <CardBoundary title="Live Balance">
          <LinkedBalanceCard />
        </CardBoundary>
        <CardBoundary title="Household Income">
          <HouseholdIncomeCard />
        </CardBoundary>
        <CardBoundary title="Financial Checkup">
          <FinancialCheckupCard />
        </CardBoundary>
      </div>

      {/* This year's money: the budget and spending, what's going into
          savings, and the goals it funds */}
      <div className="mb-3 grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] gap-3">
        <CardBoundary title="Budget & Spending">
          <LivingCostsCard />
        </CardBoundary>
        <CardBoundary title="Contributions">
          <ContributionsCard />
        </CardBoundary>
        <CardBoundary title="Savings Goals">
          <SavingsGoalsCard />
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
