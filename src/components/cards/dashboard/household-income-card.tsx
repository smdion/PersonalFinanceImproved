"use client";

import React, { memo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, Metric } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/format";
import { useActiveSalaries } from "@/lib/hooks/use-salary-overrides";
import { useScenario } from "@/lib/context/scenario-context";
import { sumBy } from "@/lib/utils/math";
import { LoadingCard, ErrorCard } from "./utils";
import { useEffectiveSalaryProfileId } from "@/lib/hooks/use-effective-salary-profile-id";
import { useEffectiveContribProfileId } from "@/lib/hooks/use-effective-contrib-profile-id";

function HouseholdIncomeCardImpl() {
  const { viewMode } = useScenario();
  const isYtd = viewMode === "ytd";
  const isBlended = viewMode === "blended";
  const salaryActiveFields = useActiveSalaries();
  // Independent axes, each Plan pin -> globally-active setting.
  const { queryInput: salaryProfileInput } = useEffectiveSalaryProfileId();
  const {
    contributionProfileId: activeContribProfileId,
    queryInput: contribProfileInput,
  } = useEffectiveContribProfileId();
  const { data: contribProfiles } = trpc.contributionProfile.list.useQuery();
  const queryInput = {
    ...(salaryActiveFields.length > 0 ? { salaryActiveFields } : {}),
    ...contribProfileInput,
    ...salaryProfileInput,
  };
  const { data, isLoading, error } = trpc.paycheck.computeSummary.useQuery(
    Object.keys(queryInput).length > 0 ? queryInput : undefined,
  );
  if (isLoading) return <LoadingCard title="Household Income" />;
  if (error)
    return <ErrorCard title="Household Income" message="Failed to load" />;

  const activeProfileName =
    activeContribProfileId != null
      ? (contribProfiles?.find((p) => p.id === activeContribProfileId)?.name ??
        null)
      : null;

  const people = data?.people?.filter((d) => d.paycheck) ?? [];
  const periods = (d: (typeof people)[0]) =>
    isYtd ? d.paycheck!.periodsElapsedYtd : d.paycheck!.periodsPerYear;
  const blendedOf = (d: (typeof people)[0]) =>
    (d as Record<string, unknown>).blendedAnnual as
      | import("@/lib/calculators/types/calculators").BlendedAnnualTotals
      | undefined;
  // "Current Salary" (projected) shows the full formula bonus — a nominal
  // target rate, independent of what's actually pinned. "Year-End Estimate"
  // and "Actual YTD" are both grounded in what's really happening this
  // year, so they use the resolved (pinned-if-set) bonus instead. YTD
  // additionally distinguishes whether it's actually been paid yet
  // (job.bonusMonth/bonusDayOfMonth has passed) vs. still pending, and only
  // counts paid bonuses toward the YTD total so that total stays "money
  // actually received."
  const fullFormulaBonusOf = (d: (typeof people)[0]) =>
    (d as Record<string, unknown>).fullFormulaBonusEstimate as
      import("@/lib/calculators/types/calculators").BonusEstimate | undefined;
  const bonusEstimateFor = (d: (typeof people)[0]) =>
    isYtd || isBlended
      ? d.paycheck!.bonusEstimate
      : (fullFormulaBonusOf(d) ?? d.paycheck!.bonusEstimate);
  const isBonusPaidYtd = (d: (typeof people)[0]) => {
    // paycheck.computeSummary's `job` is the Salary-Profile-merged shape
    // (mergeSalaryProfileJobFields) — bonusMonth/bonusDayOfMonth live there
    // now, not on the `jobs` table. This asserts the flat, merged shape
    // PersonPaycheck/BonusSection already expect from the same `job` field
    // (see their prop types and use-paycheck-person-views.ts's `job: any`
    // escape hatch for the identical gap) rather than inventing a
    // different nesting.
    const job = d.job as {
      bonusMonth: number | null;
      bonusDayOfMonth: number | null;
    } | null;
    const bonusMonth = job?.bonusMonth;
    if (bonusMonth == null) return false;
    const day = job?.bonusDayOfMonth ?? 1;
    const today = new Date();
    const payDate = new Date(today.getFullYear(), bonusMonth - 1, day);
    return today >= payDate;
  };
  const totalBonusGross = isYtd
    ? sumBy(people, (d) =>
        isBonusPaidYtd(d) ? bonusEstimateFor(d).bonusGross : 0,
      )
    : sumBy(people, (d) => bonusEstimateFor(d).bonusGross);
  const totalBonusNet = isYtd
    ? sumBy(people, (d) =>
        isBonusPaidYtd(d) ? bonusEstimateFor(d).bonusNet : 0,
      )
    : sumBy(people, (d) => bonusEstimateFor(d).bonusNet);
  const totalGrossAnnual = isBlended
    ? sumBy(people, (d) => {
        const ba = blendedOf(d);
        return ba ? ba.gross : d.paycheck!.gross * d.paycheck!.periodsPerYear;
      }) + totalBonusGross
    : sumBy(people, (d) => d.paycheck!.gross * periods(d)) + totalBonusGross;
  const totalNetAnnual = isBlended
    ? sumBy(people, (d) => {
        const ba = blendedOf(d);
        return ba ? ba.netPay : d.paycheck!.netPay * d.paycheck!.periodsPerYear;
      }) + totalBonusNet
    : sumBy(people, (d) => d.paycheck!.netPay * periods(d)) + totalBonusNet;
  const modeLabel = isYtd
    ? "Year-to-date"
    : isBlended
      ? "Year-end estimate"
      : "Projected annual";

  return (
    <Card
      title="Household Income"
      subtitle={activeProfileName ? `Profile: ${activeProfileName}` : undefined}
      href="/paycheck"
    >
      <Metric
        value={formatCurrency(totalGrossAnnual)}
        label={`${modeLabel} (salary + bonus)`}
      />
      <div className="mt-3">
        <table className="w-full text-sm">
          <tbody>
            {people.map((d) => {
              const ba = blendedOf(d);
              return (
                <React.Fragment key={d.person.id}>
                  <tr>
                    <td className="py-0.5 text-muted w-24">{d.person.name}</td>
                    <td className="py-0.5 text-right text-primary font-medium tabular-nums">
                      {isYtd
                        ? formatCurrency(d.paycheck!.gross * periods(d))
                        : isBlended && ba
                          ? formatCurrency(ba.gross)
                          : formatCurrency(d.salary)}
                    </td>
                  </tr>
                  {bonusEstimateFor(d).bonusGross > 0 && (
                    <tr>
                      <td className="pb-1 pl-2 text-xs text-faint">
                        Bonus
                        {isYtd && (
                          <span className="ml-1">
                            ({isBonusPaidYtd(d) ? "paid" : "pending"})
                          </span>
                        )}
                      </td>
                      <td className="pb-1 text-right text-xs text-faint tabular-nums">
                        {formatCurrency(bonusEstimateFor(d).bonusGross)} gross /{" "}
                        {formatCurrency(bonusEstimateFor(d).bonusNet)} net
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 pt-2 border-t border-subtle text-xs text-faint space-y-0.5">
        <div className="flex justify-between">
          <span>
            Net {isYtd ? "YTD" : isBlended ? "year-end est." : "annual"} (after
            tax + deductions)
          </span>
          <span>{formatCurrency(totalNetAnnual)}</span>
        </div>
        <div className="flex justify-between">
          <span>Per-period take-home</span>
          <span>
            {people.map((d) => formatCurrency(d.paycheck!.netPay)).join(" /")}
          </span>
        </div>
      </div>
    </Card>
  );
}

export const HouseholdIncomeCard = memo(HouseholdIncomeCardImpl);
