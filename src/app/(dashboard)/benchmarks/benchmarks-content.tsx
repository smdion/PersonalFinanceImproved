"use client";

/** Benchmarks page body: market comparison first, then what you hold and what it costs. Holding history (data entry) lives on Portfolio. */
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { ComparisonSection } from "@/components/investments/comparison-section";
import { HoldingsSection } from "@/components/investments/holdings-section";
import Link from "next/link";
import { holdingHistoryHref } from "@/lib/config/page-links";

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
      <p className="text-caption text-faint">
        What each account held over time is entered on Portfolio:{" "}
        <Link
          href={holdingHistoryHref}
          className="text-blue-600 hover:underline dark:text-blue-400"
        >
          Holding history
        </Link>
        .
      </p>
    </div>
  );
}
