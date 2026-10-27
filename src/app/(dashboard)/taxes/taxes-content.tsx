"use client";

/** Taxes page body: the year's tax line by line, then the Roth IRA check. */
import { FocusTarget } from "@/components/ui/focus-target";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingCard, ErrorCard } from "@/components/cards/dashboard/utils";
import { useHouseholdIncomeSummary } from "@/lib/hooks/use-household-income-summary";
import { TaxBreakdown } from "@/components/taxes/tax-breakdown";
import { RothIraSection } from "@/components/taxes/roth-ira-section";
import { FilingStatusRow } from "@/components/taxes/filing-status-row";
import { Card } from "@/components/ui/card";
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
          {!data.householdTax && (
            <Card title="Filing status">
              <p className="text-faint mb-2 text-xs">
                No one has a paycheck set up, so there&apos;s no tax for this
                year to show. The filing status still sets the retirement
                projection&apos;s brackets.
              </p>
              <FilingStatusRow
                status={data.filingStatus}
                source={data.filingStatusSource}
              />
            </Card>
          )}
          {data.householdTax && (
            <FocusTarget topic="rothIra">
              <RothIraSection wageAgi={data.householdTax.wageAgi} />
            </FocusTarget>
          )}
        </div>
      )}
    </div>
  );
}
