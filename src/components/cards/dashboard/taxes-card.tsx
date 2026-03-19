"use client";

import { trpc } from "@/lib/trpc";
import { Card, Metric } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useSalaryOverrides } from "@/lib/hooks/use-salary-overrides";
import { useScenario } from "@/lib/context/scenario-context";
import { LoadingCard, ErrorCard } from "./utils";

export function TaxesCard() {
  const { viewMode } = useScenario();
  const isYtd = viewMode === "ytd";
  const salaryOverrides = useSalaryOverrides();
  const [activeContribProfileId] = usePersistedSetting<number | null>(
    "active_contrib_profile_id",
    null,
  );
  const [taxYearSetting] = usePersistedSetting<number | null>(
    "paycheck_tax_year",
    null,
  );
  const queryInput = {
    ...(salaryOverrides.length > 0 ? { salaryOverrides } : {}),
    ...(activeContribProfileId != null
      ? { contributionProfileId: activeContribProfileId }
      : {}),
    ...(taxYearSetting != null ? { taxYearOverride: taxYearSetting } : {}),
  };
  const { data, isLoading, error } = trpc.paycheck.getSummary.useQuery(
    Object.keys(queryInput).length > 0 ? queryInput : undefined,
  );
  if (isLoading) return <LoadingCard title="Taxes" />;
  if (error) return <ErrorCard title="Taxes" message="Failed to load" />;

  const people = data?.people?.filter((d) => d.paycheck && d.tax) ?? [];
  if (people.length === 0)
    return (
      <Card title="Taxes" href="/paycheck">
        <p className="text-sm text-faint">
          Add a job on the Paycheck page to see tax estimates.
        </p>
      </Card>
    );

  // Household-level tax (combined federal, per-person FICA) for annual projection.
  // Per-person calculateTax double-counts the MFJ standard deduction — the router
  // computes a combined household result with one standard deduction applied once.
  const householdTax = data?.householdTax;
  const taxResult = householdTax ?? people[0]?.tax;

  // For annual projection: use the household-level tax calculation which correctly
  // combines incomes, applies ONE standard deduction, and caps SS per-person.
  // For YTD: use paycheck-based withholding since it reflects actual amounts withheld.
  let totalFederal: number;
  let totalFica: number;
  if (isYtd) {
    const periods = (d: (typeof people)[0]) => d.paycheck!.periodsElapsedYtd;
    totalFederal = people.reduce(
      (s, d) => s + d.paycheck!.federalWithholding * periods(d),
      0,
    );
    totalFica = people.reduce(
      (s, d) =>
        s + (d.paycheck!.ficaSS + d.paycheck!.ficaMedicare) * periods(d),
      0,
    );
  } else if (householdTax) {
    totalFederal = householdTax.federalTax;
    totalFica = householdTax.ficaSS + householdTax.ficaMedicare;
  } else {
    // Fallback to per-person sum if household calc unavailable
    totalFederal = people.reduce((s, d) => s + (d.tax?.federalTax ?? 0), 0);
    totalFica = people.reduce(
      (s, d) => s + (d.tax?.ficaSS ?? 0) + (d.tax?.ficaMedicare ?? 0),
      0,
    );
  }

  return (
    <Card title="Taxes" href="/paycheck">
      <Metric
        value={formatCurrency(totalFederal + totalFica)}
        label={isYtd ? "Total taxes (YTD)" : "Total annual taxes (projected)"}
      />
      <div className="mt-3 space-y-1">
        <div className="flex justify-between text-sm">
          <span className="text-muted">
            {isYtd ? "Federal W/H" : "Federal Income Tax"}
          </span>
          <span className="text-primary">{formatCurrency(totalFederal)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted">FICA (SS + Med)</span>
          <span className="text-primary">{formatCurrency(totalFica)}</span>
        </div>
        {taxResult && (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-muted">
                Effective rate
                <HelpTip text="Actual percentage of total income paid in federal tax. Lower than marginal due to progressive brackets." />
              </span>
              <span className="text-primary">
                {formatPercent(taxResult.effectiveRate, 1)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted">
                Marginal rate
                <HelpTip text="Tax rate on your next dollar of income. This is the bracket your top earnings fall into." />
              </span>
              <span className="text-primary">
                {formatPercent(taxResult.marginalRate, 1)}
              </span>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
