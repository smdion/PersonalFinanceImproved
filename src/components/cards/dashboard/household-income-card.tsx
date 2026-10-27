"use client";

import React, { memo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, Metric } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/format";
import { useScenario } from "@/lib/context/scenario-context";
import { sumBy } from "@/lib/utils/math";
import { LoadingCard, ErrorCard } from "./utils";
import { TaxesSummary } from "./taxes-summary";
import { useHouseholdIncomeSummary } from "@/lib/hooks/use-household-income-summary";
import { RothIraLine } from "@/components/taxes/roth-ira-section";

function HouseholdIncomeCardImpl() {
  const { viewMode } = useScenario();
  const isYtd = viewMode === "ytd";
  const isBlended = viewMode === "blended";
  const { data: contribProfiles } = trpc.contributionProfile.list.useQuery();
  const {
    data,
    isLoading,
    error,
    contributionProfileId: activeContribProfileId,
  } = useHouseholdIncomeSummary();
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
    isYtd
      ? Math.max(
          0,
          d.paycheck!.periodsElapsedYtd - d.paycheck!.periodsBeforeStart,
        )
      : d.paycheck!.periodsPerYear;
  const blendedOf = (d: (typeof people)[0]) =>
    (d as Record<string, unknown>).blendedAnnual as
      | import("@/lib/calculators/types/calculators").BlendedAnnualTotals
      | undefined;
  // Every view uses the resolved bonus — the set (actual) bonus if there
  // is one, else the formula — the same bonus the taxes below are figured
  // on, so gross, net and tax reconcile. When a set bonus differs from the
  // formula, the formula figure is shown beside it. YTD additionally
  // distinguishes whether it's actually been paid yet
  // (job.bonusMonth/bonusDayOfMonth has passed) vs. still pending, and only
  // counts paid bonuses toward the YTD total so that total stays "money
  // actually received."
  const bonusEstimateFor = (d: (typeof people)[0]) => d.paycheck!.bonusEstimate;
  /** The formula bonus, when a set bonus is in use and differs from it. */
  const formulaBonusIfDifferent = (d: (typeof people)[0]) => {
    if (!("fullFormulaBonusEstimate" in d)) return null;
    if (d.resolvedBonusTerms.bonusOverride === null) return null;
    const formula = d.fullFormulaBonusEstimate.bonusGross;
    return Math.abs(formula - d.paycheck!.bonusEstimate.bonusGross) >= 1
      ? formula
      : null;
  };
  // The calculator's bonus period (null when there's no bonus date, or it
  // falls before the job started) against the paydays so far.
  const isBonusPaidYtd = (d: (typeof people)[0]) => {
    const p = d.paycheck!.bonusPeriod;
    return p !== null && p <= d.paycheck!.periodsElapsedYtd;
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
  // Projected: household annual income — the figure the taxes are on.
  const income = data?.householdIncome ?? null;
  const totalGrossAnnual = isBlended
    ? sumBy(people, (d) => {
        const ba = blendedOf(d);
        return ba ? ba.gross : d.paycheck!.gross * d.paycheck!.periodsPerYear;
      }) + totalBonusGross
    : !isYtd && income
      ? income.gross
      : sumBy(people, (d) => d.paycheck!.gross * periods(d)) + totalBonusGross;
  const totalNetAnnual = isBlended
    ? sumBy(people, (d) => {
        const ba = blendedOf(d);
        return ba ? ba.netPay : d.paycheck!.netPay * d.paycheck!.periodsPerYear;
      }) + totalBonusNet
    : !isYtd && income
      ? income.netRegular + income.netBonus
      : sumBy(people, (d) => d.paycheck!.netPay * periods(d)) + totalBonusNet;
  // Same words as the header's View toggle.
  const modeLabel = isYtd
    ? "Year to date"
    : isBlended
      ? "Year-end estimate"
      : "Projected";

  return (
    <Card
      title="Household Income"
      subtitle={activeProfileName ? `Profile: ${activeProfileName}` : undefined}
      href="/paycheck"
    >
      <Metric
        value={formatCurrency(totalGrossAnnual)}
        label={`${modeLabel} (salary + bonus${(income?.otherCashPay ?? 0) > 0 ? " + other pay" : ""})`}
      />
      <div className="mt-3">
        <table className="w-full text-sm">
          <tbody>
            {people.map((d) => {
              const ba = blendedOf(d);
              return (
                <React.Fragment key={d.person.id}>
                  <tr>
                    <td className="text-muted w-24 py-0.5">{d.person.name}</td>
                    <td className="text-primary py-0.5 text-right font-medium tabular-nums">
                      {isYtd
                        ? formatCurrency(d.paycheck!.gross * periods(d))
                        : isBlended && ba
                          ? formatCurrency(ba.gross)
                          : formatCurrency(d.salary)}
                    </td>
                  </tr>
                  {bonusEstimateFor(d).bonusGross > 0 && (
                    <tr>
                      <td className="text-faint pb-1 pl-2 text-xs">
                        Bonus
                        {isYtd && (
                          <span className="ml-1">
                            ({isBonusPaidYtd(d) ? "paid" : "pending"})
                          </span>
                        )}
                      </td>
                      <td className="text-faint pb-1 text-right text-xs tabular-nums">
                        {formatCurrency(bonusEstimateFor(d).bonusGross)} gross /{" "}
                        {formatCurrency(bonusEstimateFor(d).bonusNet)} net
                      </td>
                    </tr>
                  )}
                  {formulaBonusIfDifferent(d) !== null && (
                    <tr>
                      <td
                        colSpan={2}
                        className="text-faint pb-1 pl-2 text-right text-xs"
                      >
                        Formula target{" "}
                        {formatCurrency(formulaBonusIfDifferent(d)!)}; using
                        your set bonus
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-subtle text-faint mt-2 space-y-0.5 border-t pt-2 text-xs">
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
        {data?.householdTax && (
          <RothIraLine wageAgi={data.householdTax.wageAgi} />
        )}
      </div>
      <TaxesSummary data={data} viewMode={viewMode} />
    </Card>
  );
}

export const HouseholdIncomeCard = memo(HouseholdIncomeCardImpl);
