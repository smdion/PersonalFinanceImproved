"use client";

import { PageHeader } from "@/components/ui/page-header";
import { CardBoundary } from "@/components/cards/dashboard/utils";
import {
  HouseholdIncomeCard,
  SavingsRateCard,
  BudgetStatusCard,
  SavingsGoalsCard,
  RetirementCard,
  MortgageCard,
  NetWorthCard,
  LinkedBalanceCard,
  ContributionsCard,
  TaxesCard,
  FinancialCheckupCard,
  FidelityMultiplierCard,
  DollarMultiplierCard,
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
      <div className="mb-3 grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] gap-3">
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

      {/* This year's saving: the plan vs what's going in, the rate, the goals */}
      <div className="mb-3 grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] gap-3">
        <CardBoundary title="Contributions">
          <ContributionsCard />
        </CardBoundary>
        <CardBoundary title="Savings Rate">
          <SavingsRateCard />
        </CardBoundary>
        <CardBoundary title="Savings Goals">
          <SavingsGoalsCard />
        </CardBoundary>
      </div>

      {/* Retirement outlook */}
      <div className="mb-3 grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] gap-3">
        <CardBoundary title="Retirement">
          <RetirementCard />
        </CardBoundary>
        <CardBoundary title="Fidelity Multiplier">
          <FidelityMultiplierCard />
        </CardBoundary>
        <CardBoundary title="Dollar Multiplier">
          <DollarMultiplierCard />
        </CardBoundary>
      </div>

      {/* Details */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3">
        <CardBoundary title="Living Costs">
          <LivingCostsCard />
        </CardBoundary>
        <CardBoundary title="Mortgage">
          <MortgageCard />
        </CardBoundary>
        <CardBoundary title="Budget Status">
          <BudgetStatusCard />
        </CardBoundary>
        <CardBoundary title="Taxes">
          <TaxesCard />
        </CardBoundary>
      </div>
    </div>
  );
}
