"use client";

/** Taxes page body: the year's tax line by line, then the Roth IRA check. */
import { PageHeader } from "@/components/ui/page-header";
import { LoadingCard, ErrorCard } from "@/components/cards/dashboard/utils";
import { useHouseholdIncomeSummary } from "@/lib/hooks/use-household-income-summary";
import { TaxBreakdown } from "@/components/taxes/tax-breakdown";
import { RothIraSection } from "@/components/taxes/roth-ira-section";
import { useFullYearNote } from "@/lib/hooks/use-full-year-note";

export function TaxesContent() {
  const { data, isLoading, error } = useHouseholdIncomeSummary();
  const fullYearNote = useFullYearNote();
  return (
    <div className="space-y-4">
      <PageHeader
        title="Taxes this year"
        subtitle="This year's tax on salary and bonus, and whether you can contribute to a Roth IRA directly"
      />
      {fullYearNote && (
        <p className="text-caption text-faint -mt-2">{fullYearNote}.</p>
      )}
      {isLoading ? (
        <LoadingCard title="Taxes this year" />
      ) : error || !data ? (
        <ErrorCard title="Taxes this year" message="Failed to load" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <TaxBreakdown data={data} />
          {data.householdTax && (
            <RothIraSection wageAgi={data.householdTax.wageAgi} />
          )}
        </div>
      )}
    </div>
  );
}
