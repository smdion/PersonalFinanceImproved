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
  ContributionsCard,
  TaxesCard,
  FinancialCheckupCard,
  FidelityMultiplierCard,
  DollarMultiplierCard,
  LivingCostsCard,
} from "@/components/cards/dashboard";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { trpc } from "@/lib/trpc";

export default function DashboardPage() {
  const utils = trpc.useUtils();
  const { data: onboarding } = trpc.settings.isOnboardingComplete.useQuery();

  return (
    <div>
      {onboarding && !onboarding.complete && (
        <OnboardingWizard onComplete={() => utils.settings.invalidate()} />
      )}
      <PageHeader title="Dashboard" subtitle="Financial overview" />

      {/* Primary metrics row */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-3">
        <CardBoundary title="Net Worth">
          <NetWorthCard />
        </CardBoundary>
        <CardBoundary title="Household Income">
          <HouseholdIncomeCard />
        </CardBoundary>
        <CardBoundary title="Financial Checkup">
          <FinancialCheckupCard />
        </CardBoundary>
      </div>

      {/* Secondary row */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-3">
        <CardBoundary title="Savings Goals">
          <SavingsGoalsCard />
        </CardBoundary>
        <CardBoundary title="Retirement">
          <RetirementCard />
        </CardBoundary>
        <CardBoundary title="Contributions">
          <ContributionsCard />
        </CardBoundary>
      </div>

      {/* Retirement & budgeting insights */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-3">
        <CardBoundary title="Fidelity Multiplier">
          <FidelityMultiplierCard />
        </CardBoundary>
        <CardBoundary title="Dollar Multiplier">
          <DollarMultiplierCard />
        </CardBoundary>
        <CardBoundary title="Living Costs">
          <LivingCostsCard />
        </CardBoundary>
      </div>

      {/* Detail row */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <CardBoundary title="Mortgage">
          <MortgageCard />
        </CardBoundary>
        <CardBoundary title="Savings Rate">
          <SavingsRateCard />
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
