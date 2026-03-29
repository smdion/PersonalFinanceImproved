"use client";

import React from "react";
import { trpc } from "@/lib/trpc";
import { Card, Metric } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/format";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useSalaryOverrides } from "@/lib/hooks/use-salary-overrides";
import { useScenario } from "@/lib/context/scenario-context";
import { LoadingCard, ErrorCard } from "./utils";

export function HouseholdIncomeCard() {
  const { viewMode } = useScenario();
  const isYtd = viewMode === "ytd";
  const salaryOverrides = useSalaryOverrides();
  const [activeContribProfileId] = usePersistedSetting<number | null>(
    "active_contrib_profile_id",
    null,
  );
  const { data: contribProfiles } = trpc.contributionProfile.list.useQuery();
  const queryInput = {
    ...(salaryOverrides.length > 0 ? { salaryOverrides } : {}),
    ...(activeContribProfileId != null
      ? { contributionProfileId: activeContribProfileId }
      : {}),
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
  const totalBonusGross = isYtd
    ? 0
    : people.reduce((s, d) => s + d.paycheck!.bonusEstimate.bonusGross, 0);
  const totalBonusNet = isYtd
    ? 0
    : people.reduce((s, d) => s + d.paycheck!.bonusEstimate.bonusNet, 0);
  const totalGrossAnnual =
    people.reduce((s, d) => s + d.paycheck!.gross * periods(d), 0) +
    totalBonusGross;
  const totalNetAnnual =
    people.reduce((s, d) => s + d.paycheck!.netPay * periods(d), 0) +
    totalBonusNet;
  const modeLabel = isYtd ? "Year-to-date" : "Projected annual";

  return (
    <Card
      title="Household Income"
      subtitle={activeProfileName ? `Profile: ${activeProfileName}` : undefined}
      href="/paycheck"
    >
      <Metric
        value={formatCurrency(totalGrossAnnual)}
        label={`${modeLabel} (salary${isYtd ? "" : " + bonus"})`}
      />
      <div className="mt-3">
        <table className="w-full text-sm">
          <tbody>
            {people.map((d) => (
              <React.Fragment key={d.person.id}>
                <tr>
                  <td className="py-0.5 text-muted w-24">{d.person.name}</td>
                  <td className="py-0.5 text-right text-primary font-medium tabular-nums">
                    {isYtd
                      ? formatCurrency(d.paycheck!.gross * periods(d))
                      : formatCurrency(d.salary)}
                  </td>
                </tr>
                {!isYtd && d.paycheck!.bonusEstimate.bonusGross > 0 && (
                  <tr>
                    <td className="pb-1 pl-2 text-xs text-faint">Bonus</td>
                    <td className="pb-1 text-right text-xs text-faint tabular-nums">
                      {formatCurrency(d.paycheck!.bonusEstimate.bonusGross)}{" "}
                      gross /{" "}
                      {formatCurrency(d.paycheck!.bonusEstimate.bonusNet)} net
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 pt-2 border-t border-subtle text-xs text-faint space-y-0.5">
        <div className="flex justify-between">
          <span>Net {isYtd ? "YTD" : "annual"} (after tax + deductions)</span>
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
