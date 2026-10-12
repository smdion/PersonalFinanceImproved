"use client";

/** Benchmarks page body: market comparison first, then what you hold and what it costs. */
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { ComparisonSection } from "@/components/investments/comparison-section";
import { HoldingsSection } from "@/components/investments/holdings-section";
import { AnalyticsContent } from "../analytics/analytics-content";

export function BenchmarksContent() {
  const user = useUser();
  if (!hasPermission(user, "portfolio")) {
    return (
      <div className="space-y-4">
        <PageHeader title="Benchmarks" />
        <EmptyState
          message="You don't have permission to view Benchmarks."
          hint="Ask an admin to grant portfolio access."
        />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Benchmarks"
        subtitle="How your investments did against the market, what you hold, and what it costs"
      />
      <ComparisonSection />
      <HoldingsSection />
      <details className="group">
        <summary className="text-secondary hover:text-primary cursor-pointer text-sm font-medium">
          Accounts SimpleFIN doesn&apos;t report holdings for
        </summary>
        <div className="mt-3">
          <AnalyticsContent embedded />
        </div>
      </details>
    </div>
  );
}
