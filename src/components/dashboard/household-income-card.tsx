"use client";

import React, { memo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, Metric } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/format";
import { useScenario } from "@/lib/context/scenario-context";
import { sumBy } from "@/lib/utils/math";
import { bonusCheckNet, yearTotals } from "@/lib/pure/paycheck/year-totals";
import type { PaycheckResult } from "@/lib/pure/paycheck/paycheck.types";
import { CardQueryBoundary, queryPending } from "./utils";
import { TaxesSummary } from "./taxes-summary";
import { useHouseholdIncomeSummary } from "@/lib/hooks/use-household-income-summary";
import { RothIraLine } from "@/components/taxes/roth-ira-line";

/** A person's regular checks from the year schedule (Social Security at the full rate until
 *  the wage base): year to date, or the whole year. */
function regularPay(
  pc: Pick<
    PaycheckResult,
    "yearSchedule" | "periodsElapsedYtd" | "periodsPerYear"
  >,
  ytd: boolean,
): { gross: number; net: number } {
  return yearTotals(
    pc.yearSchedule,
    1,
    ytd ? pc.periodsElapsedYtd : pc.periodsPerYear,
  );
}

/** The current job's bonus check this year (its year-schedule row): the gross, and the
 *  take-home after its own withholding, FICA and contributions. Zero when none is paid. */
function bonusCheck(
  pc: Pick<PaycheckResult, "yearSchedule" | "bonusEstimate">,
): { gross: number; net: number } {
  const row = pc.yearSchedule.find((r) => r.bonusGross > 0);
  if (!row) return { gross: 0, net: 0 };
  return {
    gross: row.bonusGross,
    net: bonusCheckNet({
      gross: row.bonusGross,
      federal: row.bonusWithholding,
      fica: row.bonusFica,
      contributions: pc.bonusEstimate.bonusContributions,
    }),
  };
}

function HouseholdIncomeCardImpl() {
  const { viewMode } = useScenario();
  const isYtd = viewMode === "ytd";
  const isBlended = viewMode === "blended";
  const { data: contributionProfiles } =
    trpc.contributionProfile.list.useQuery();
  const summary = useHouseholdIncomeSummary();
  const { data, contributionProfileId: activeContributionProfileId } = summary;
  if (queryPending(summary))
    return <CardQueryBoundary title="Household Income" query={summary} />;

  const activeProfileName =
    activeContributionProfileId != null
      ? (contributionProfiles?.find((p) => p.id === activeContributionProfileId)
          ?.name ?? null)
      : null;

  const people = data?.people.filter((d) => d.paycheck) ?? [];
  const regular = (d: (typeof people)[0]) => regularPay(d.paycheck!, isYtd);
  const blendedOf = (d: (typeof people)[0]) =>
    (d as Record<string, unknown>).blendedAnnual as
      | import("@/lib/pure/paycheck/paycheck.types").BlendedAnnualTotals
      | undefined;
  // Every view uses the current job's bonus check, like its regular pay beside it (none
  // outside start…last day). YTD counts only bonuses already paid.
  const bonusGrossFor = (d: (typeof people)[0]) =>
    bonusCheck(d.paycheck!).gross;
  const bonusNetFor = (d: (typeof people)[0]) => bonusCheck(d.paycheck!).net;
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
  // falls outside the job's checks) against the paydays so far.
  const isBonusPaidYtd = (d: (typeof people)[0]) => {
    const p = d.paycheck!.bonusPeriod;
    return p !== null && p <= d.paycheck!.periodsElapsedYtd;
  };
  const totalBonusGross = isYtd
    ? sumBy(people, (d) => (isBonusPaidYtd(d) ? bonusGrossFor(d) : 0))
    : sumBy(people, bonusGrossFor);
  const totalBonusNet = isYtd
    ? sumBy(people, (d) => (isBonusPaidYtd(d) ? bonusNetFor(d) : 0))
    : sumBy(people, (d) => bonusNetFor(d));
  // Projected: household annual income — the figure the taxes are on.
  const income = data?.householdIncome ?? null;
  const totalGrossAnnual = isBlended
    ? sumBy(people, (d) => {
        const ba = blendedOf(d);
        return ba ? ba.gross : d.paycheck!.gross * d.paycheck!.periodsPerYear;
      }) + totalBonusGross
    : !isYtd && income
      ? income.gross
      : sumBy(people, (d) => regular(d).gross) + totalBonusGross;
  const totalNetAnnual = isBlended
    ? sumBy(people, (d) => {
        const ba = blendedOf(d);
        return ba ? ba.netPay : d.paycheck!.netPay * d.paycheck!.periodsPerYear;
      }) + totalBonusNet
    : !isYtd && income
      ? income.netRegular + income.netBonus
      : sumBy(people, (d) => regular(d).net) + totalBonusNet;
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
                        ? formatCurrency(regular(d).gross)
                        : isBlended && ba
                          ? formatCurrency(ba.gross)
                          : formatCurrency(d.salary)}
                    </td>
                  </tr>
                  {bonusGrossFor(d) > 0 && (
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
                        {formatCurrency(bonusGrossFor(d))} gross /{" "}
                        {formatCurrency(bonusNetFor(d))} net
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
