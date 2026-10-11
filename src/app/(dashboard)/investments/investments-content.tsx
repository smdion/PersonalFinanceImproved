"use client";

/** Investments page body: market comparison first, then funds & targets. */
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { ComparisonSection } from "@/components/investments/comparison-section";
import { AnalyticsContent } from "../analytics/analytics-content";

export function InvestmentsContent() {
  const user = useUser();
  if (!hasPermission(user, "portfolio")) {
    return (
      <div className="space-y-4">
        <PageHeader title="Investments" />
        <EmptyState
          message="You don't have permission to view Investments."
          hint="Ask an admin to grant portfolio access."
        />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Investments"
        subtitle="How your investments did against the market, what you hold, and what it costs"
      />
      <ComparisonSection />
      <AnalyticsContent embedded />
    </div>
  );
}
