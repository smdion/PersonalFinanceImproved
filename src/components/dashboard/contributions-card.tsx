"use client";

import { useHighIncomeHousehold } from "@/lib/hooks/use-high-income-household";
import { useHighIncomeLine } from "@/lib/hooks/use-high-income-line";
import { focusHref } from "@/lib/config/focus-topics";
import React, { useState, memo } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import {
  PERF_CATEGORY_RETIREMENT,
  PERF_CATEGORY_BROKERAGE,
  taxTypeLabel,
} from "@/lib/config/display-labels";
import {
  accountColor,
  accountMatchColor,
  accountTextColor,
} from "@/lib/utils/colors";
import { useScenario } from "@/lib/context/scenario-context";
import { OVER_LIMIT_THRESHOLD } from "@/lib/constants";
import { safeDivide } from "@/lib/utils/math";
import {
  ContributionPeriodToggle,
  getContributionMultiplier,
  getPeriodSuffix,
  householdPeriodsPerYear,
  type ContributionPeriod,
} from "@/components/contributions/contrib-period-toggle";
import {
  getAllCategories,
  getAccountTypeConfig,
} from "@/lib/config/account-types";
import { useSavingsRateOptions } from "@/lib/hooks/use-savings-rate-options";
import {
  householdSavings,
  type HouseholdSavings,
  type SavingsGroup,
} from "@/lib/pure/contributions/savings-rate";
import type { AccountCategory } from "@/lib/config/account-types";
import { FundingBar } from "@/components/paycheck/funding-bar";
import { PaceStatusText } from "./pace-status";
import { CardQueryBoundary, queryPending } from "./utils";
import { useContributionSummaryInput } from "@/lib/hooks/use-contribution-summary-input";

function ContributionsCardImpl() {
  const { viewMode } = useScenario();
  const summary = trpc.contribution.computeSummary.useQuery(
    useContributionSummaryInput(),
  );
  const { data } = summary;
  // Live status per tracked account (needs the portfolio permission; the
  // card works without it).
  const { data: pace } = trpc.investments.computeSavingsThisYear.useQuery(
    undefined,
    { retry: false },
  );
  const paceOf = (ids: readonly number[]) => {
    const a = pace?.accounts.find(
      (r) => ids.includes(r.performanceAccountId) && r.status !== "no_plan",
    );
    return a ? (
      <span className="ml-1.5">
        <PaceStatusText status={a.status} latest={a.latest} />
      </span>
    ) : null;
  };
  const [contributionPeriod, setContributionPeriod] =
    useState<ContributionPeriod>("annual");
  const highIncome = useHighIncomeLine();
  const { excludeMatch, includePortfolio } = useSavingsRateOptions(
    useHighIncomeHousehold().highIncome === true,
  );
  const queries = [summary, highIncome];
  if (queryPending(queries))
    return <CardQueryBoundary title="Contributions" query={queries} />;

  const people = data?.people.filter((d) => d.accountTypes.length > 0) ?? [];

  const jointAts = data?.jointAccountTypes ?? [];
  // Footer totals: the same calculation as every savings rate
  // (householdSavings), with and without the match.
  const savingsOf = (withoutMatch: boolean) =>
    householdSavings(
      data?.people.filter((d) => d.result) ?? [],
      jointAts,
      viewMode,
      { excludeMatch: withoutMatch },
    );
  const savingsWith = savingsOf(false);
  const savingsWithout = savingsOf(true);
  const groupTotal = (sv: HouseholdSavings, g: SavingsGroup) =>
    sv.groups.find((x) => x.group === g)?.total ?? 0;
  const footer = [
    {
      key: "retirement",
      label: PERF_CATEGORY_RETIREMENT,
      without: groupTotal(savingsWithout, "retirement"),
      with: groupTotal(savingsWith, "retirement"),
    },
    {
      key: "portfolio",
      label: PERF_CATEGORY_BROKERAGE,
      without: groupTotal(savingsWithout, "portfolio"),
      with: groupTotal(savingsWith, "portfolio"),
    },
    {
      key: "total",
      label: `Total${includePortfolio ? "" : " (retirement only)"}${
        viewMode === "ytd" ? " (YTD)" : viewMode === "blended" ? " (Est.)" : ""
      }`,
      without: includePortfolio
        ? savingsWithout.total
        : groupTotal(savingsWithout, "retirement"),
      with: includePortfolio
        ? savingsWith.total
        : groupTotal(savingsWith, "retirement"),
    },
  ];

  const avgPeriodsPerYear = householdPeriodsPerYear(
    people.map((p) => p.periodsPerYear!),
  );
  const householdMult = getContributionMultiplier(
    contributionPeriod,
    avgPeriodsPerYear,
  );
  const suffix = getPeriodSuffix(contributionPeriod);

  return (
    <Card
      title="Contributions"
      href={focusHref({ topic: "contributionElections" })}
      headerRight={
        <ContributionPeriodToggle
          value={contributionPeriod}
          onChange={setContributionPeriod}
        />
      }
    >
      <div className="space-y-3">
        {people.map((p, personIndex) => {
          const mult = getContributionMultiplier(
            contributionPeriod,
            p.periodsPerYear!,
          );
          return (
            <div
              key={p.person.id}
              className={personIndex > 0 ? "border-subtle border-t pt-3" : ""}
            >
              <p className="text-muted mb-1 text-xs font-medium uppercase">
                {p.person.name}
              </p>
              <div className="space-y-2.5">
                {p.accountTypes.map((at) => {
                  const hasLimit = at.limit > 0;
                  const isKnownCategory = (
                    getAllCategories() as string[]
                  ).includes(at.categoryKey);
                  const matchCountsTowardLimit = isKnownCategory
                    ? getAccountTypeConfig(at.categoryKey as AccountCategory)
                        .matchCountsTowardLimit
                    : false;
                  const matchPercentOfLimit =
                    hasLimit && at.views[viewMode].employerMatch > 0
                      ? at.views[viewMode].employerMatch / at.limit
                      : undefined;

                  return (
                    <div key={at.accountType}>
                      {/* Account type + employee amount + employer match */}
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="text-muted font-medium">
                          {at.accountType}
                          {at.isJoint && (
                            <span className="text-faint text-caption ml-1 font-normal">
                              (Joint)
                            </span>
                          )}
                          {paceOf(at.performanceAccountIds)}
                        </span>
                        <div className="text-right">
                          <span className="text-primary font-medium">
                            {formatCurrency(
                              at.views[viewMode].employeeContrib * mult,
                            )}
                          </span>
                          {at.currentPctOfSalary !== null && (
                            <span className="text-faint text-caption ml-1">
                              ({Number(at.currentPctOfSalary.toFixed(1))}% of
                              pay)
                            </span>
                          )}
                        </div>
                      </div>

                      {hasLimit && (
                        <div className="mt-1">
                          <FundingBar
                            pct={at.views[viewMode].fundingPct}
                            matchPercent={matchPercentOfLimit}
                            matchCountsTowardLimit={matchCountsTowardLimit}
                            accountType={at.categoryKey}
                            limitMarker
                          />
                          <div className="text-caption mt-0.5 flex justify-between">
                            <span
                              className={
                                at.views[viewMode].fundingPct >
                                OVER_LIMIT_THRESHOLD
                                  ? "font-medium text-red-600"
                                  : at.views[viewMode].fundingPct >= 1
                                    ? "font-medium text-green-600"
                                    : "text-muted"
                              }
                            >
                              {formatPercent(at.views[viewMode].fundingPct)} of{" "}
                              {formatCurrency(at.limit)}
                              {at.views[viewMode].fundingPct >
                                OVER_LIMIT_THRESHOLD && (
                                <Badge color="red" className="ml-1">
                                  Over
                                </Badge>
                              )}
                            </span>
                            {at.views[viewMode].fundingMissing > 0 && (
                              <span className="text-red-500">
                                -
                                {formatCurrency(
                                  at.views[viewMode].fundingMissing * mult,
                                )}
                              </span>
                            )}
                          </div>
                          {/* Employer match IRS context */}
                          {at.employerMatch > 0 && (
                            <p className="text-caption mt-0.5 text-blue-500">
                              Match
                              {matchCountsTowardLimit
                                ? " counts toward IRS limit"
                                : " does not count toward IRS limit"}
                            </p>
                          )}
                          {/* Need +X% to max */}
                          {at.views[viewMode].fundingPct <=
                            OVER_LIMIT_THRESHOLD &&
                            at.views[viewMode].pctOfSalaryToMax !== null &&
                            Math.floor(at.views[viewMode].pctOfSalaryToMax) >
                              0 && (
                              <p className="text-caption mt-0.5 text-amber-600">
                                Need +
                                {Math.floor(
                                  at.views[viewMode].pctOfSalaryToMax,
                                )}
                                % to max
                              </p>
                            )}
                          {at.views[viewMode].fundingPct <=
                            OVER_LIMIT_THRESHOLD &&
                            at.views[viewMode].pctOfSalaryToMax !== null &&
                            Math.floor(at.views[viewMode].pctOfSalaryToMax) ===
                              0 && (
                              <p className="text-caption mt-0.5 text-green-600">
                                {/* A plan reaching the limit isn't money in:
                                    only Actual YTD can say "maxed out". */}
                                {viewMode === "blended"
                                  ? "On track to max"
                                  : "Set to max"}
                              </p>
                            )}
                          {viewMode === "ytd" &&
                            at.views.ytd.fundingPct >= 1 && (
                              <p className="text-caption mt-0.5 text-green-600">
                                Maxed out
                              </p>
                            )}
                          {/* Bonus contrib note */}
                          {at.bonusContrib > 0 && (
                            <p className="text-caption mt-0.5 text-amber-600">
                              * Incl. ~{formatCurrency(at.bonusContrib * mult)}
                              {suffix} from bonus
                            </p>
                          )}
                          {/* Trad/Roth split */}
                          {(at.tradContrib > 0 || at.taxFreeContrib > 0) &&
                            at.tradContrib !== at.employeeContrib &&
                            at.taxFreeContrib !== at.employeeContrib && (
                              <div className="text-caption text-faint mt-0.5 flex gap-2">
                                {at.tradContrib > 0 && (
                                  <span>
                                    {taxTypeLabel("preTax")}:{" "}
                                    {formatCurrency(at.tradContrib * mult)}
                                  </span>
                                )}
                                {at.taxFreeContrib > 0 && (
                                  <span>
                                    {taxTypeLabel("taxFree")}:{" "}
                                    {formatCurrency(at.taxFreeContrib * mult)}
                                  </span>
                                )}
                              </div>
                            )}
                        </div>
                      )}

                      {/* Discount bar (ESPP-style) — config-driven via hasDiscountBar */}
                      {!hasLimit &&
                        at.hasDiscountBar &&
                        at.employerMatch > 0 && (
                          <div className="mt-1">
                            <div className="bg-surface-strong relative h-2 w-full rounded-full">
                              <div
                                className={`${accountColor(at.categoryKey)} absolute top-0 left-0 h-2 rounded-l-full transition-all`}
                                style={{
                                  width: `${(at.employeeContrib / (at.employeeContrib + at.employerMatch)) * 100}%`,
                                }}
                                title={`Your cost: ${formatCurrency(at.views[viewMode].employeeContrib * mult)}${suffix}`}
                              />
                              <div
                                className={`${accountMatchColor(at.categoryKey)} absolute top-0 h-2 rounded-r-full transition-all`}
                                style={{
                                  left: `${(at.employeeContrib / (at.employeeContrib + at.employerMatch)) * 100}%`,
                                  width: `${(at.employerMatch / (at.employeeContrib + at.employerMatch)) * 100}%`,
                                }}
                                title={`${at.employerMatchLabel}: ${formatCurrency(at.views[viewMode].employerMatch * mult)}${suffix}`}
                              />
                            </div>
                            <div className="text-caption mt-0.5 flex justify-between">
                              <span
                                className={accountTextColor(at.categoryKey)}
                              >
                                Value:{" "}
                                {formatCurrency(
                                  (at.views[viewMode].employeeContrib +
                                    at.views[viewMode].employerMatch) *
                                    mult,
                                )}
                                {suffix}
                              </span>
                              <span
                                className={`${accountTextColor(at.categoryKey)} font-medium`}
                              >
                                +
                                {formatPercent(
                                  safeDivide(
                                    at.employerMatch,
                                    at.employeeContrib,
                                    0,
                                  )!,
                                )}{" "}
                                {at.employerMatchLabel}
                              </span>
                            </div>
                          </div>
                        )}

                      {/* Non-discount non-limited accounts: solid bar + match info */}
                      {!hasLimit && !at.hasDiscountBar && (
                        <div className="mt-1">
                          <div className="bg-surface-strong relative h-2 w-full rounded-full">
                            {at.employerMatch > 0 ? (
                              <>
                                <div
                                  className={`${accountColor(at.categoryKey)} absolute top-0 left-0 h-2 rounded-l-full`}
                                  style={{
                                    width: `${(at.employeeContrib / (at.employeeContrib + at.employerMatch)) * 100}%`,
                                  }}
                                  title={`You: ${formatCurrency(at.views[viewMode].employeeContrib * mult)}${suffix}`}
                                />
                                <div
                                  className={`${accountMatchColor(at.categoryKey)} absolute top-0 h-2 rounded-r-full`}
                                  style={{
                                    left: `${(at.employeeContrib / (at.employeeContrib + at.employerMatch)) * 100}%`,
                                    width: `${(at.employerMatch / (at.employeeContrib + at.employerMatch)) * 100}%`,
                                  }}
                                  title={`${at.employerMatchLabel}: ${formatCurrency(at.views[viewMode].employerMatch * mult)}${suffix}`}
                                />
                              </>
                            ) : (
                              <div
                                className={`${accountColor(at.categoryKey)} h-2 rounded-full`}
                                style={{ width: "100%" }}
                                title={`${formatCurrency(at.views[viewMode].employeeContrib * mult)}${suffix}`}
                              />
                            )}
                          </div>
                          <div className="text-caption mt-0.5 flex justify-between">
                            <span className="text-faint">No IRS limit</span>
                            {at.employerMatch > 0 && (
                              <span
                                className={`${accountTextColor(at.categoryKey)} font-medium`}
                              >
                                +
                                {formatCurrency(
                                  at.views[viewMode].employerMatch * mult,
                                )}
                                {suffix} {at.employerMatchLabel}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {/* Joint household accounts */}
        {jointAts.length > 0 && (
          <div className="border-subtle border-t pt-3">
            <p className="text-muted mb-1 text-xs font-medium uppercase">
              Joint
            </p>
            <div className="space-y-2.5">
              {jointAts.map((at) => (
                <div key={at.accountType}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-muted font-medium">
                      {at.accountType}
                      {paceOf(at.performanceAccountIds)}
                    </span>
                    <span className="text-primary font-medium">
                      {formatCurrency(
                        at.views[viewMode].employeeContrib * householdMult,
                      )}
                      {/* A year-to-date amount isn't a rate. */}
                      {viewMode !== "ytd" && suffix}
                    </span>
                  </div>
                  {/* Bar for joint accounts */}
                  {at.hasDiscountBar && at.employerMatch > 0 ? (
                    <div className="mt-1">
                      <div className="bg-surface-strong relative h-2 w-full rounded-full">
                        <div
                          className={`${accountColor(at.categoryKey)} absolute top-0 left-0 h-2 rounded-l-full`}
                          style={{
                            width: `${(at.employeeContrib / (at.employeeContrib + at.employerMatch)) * 100}%`,
                          }}
                          title={`You: ${formatCurrency(at.employeeContrib * householdMult)}${suffix}`}
                        />
                        <div
                          className={`${accountMatchColor(at.categoryKey)} absolute top-0 h-2 rounded-r-full`}
                          style={{
                            left: `${(at.employeeContrib / (at.employeeContrib + at.employerMatch)) * 100}%`,
                            width: `${(at.employerMatch / (at.employeeContrib + at.employerMatch)) * 100}%`,
                          }}
                          title={`${at.employerMatchLabel}: ${formatCurrency(at.employerMatch * householdMult)}${suffix}`}
                        />
                      </div>
                      <div className="text-caption mt-0.5 flex justify-between">
                        <span className={accountTextColor(at.categoryKey)}>
                          Value:{" "}
                          {formatCurrency(
                            (at.employeeContrib + at.employerMatch) *
                              householdMult,
                          )}
                          {suffix}
                        </span>
                        <span
                          className={`${accountTextColor(at.categoryKey)} font-medium`}
                        >
                          +
                          {formatPercent(
                            safeDivide(
                              at.employerMatch,
                              at.employeeContrib,
                              0,
                            )!,
                          )}{" "}
                          {at.employerMatchLabel}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1">
                      <div className="bg-surface-strong relative h-2 w-full rounded-full">
                        {at.employerMatch > 0 ? (
                          <>
                            <div
                              className={`${accountColor(at.categoryKey)} absolute top-0 left-0 h-2 rounded-l-full`}
                              style={{
                                width: `${(at.employeeContrib / (at.employeeContrib + at.employerMatch)) * 100}%`,
                              }}
                              title={`You: ${formatCurrency(at.employeeContrib * householdMult)}${suffix}`}
                            />
                            <div
                              className={`${accountMatchColor(at.categoryKey)} absolute top-0 h-2 rounded-r-full`}
                              style={{
                                left: `${(at.employeeContrib / (at.employeeContrib + at.employerMatch)) * 100}%`,
                                width: `${(at.employerMatch / (at.employeeContrib + at.employerMatch)) * 100}%`,
                              }}
                              title={`${at.employerMatchLabel}: ${formatCurrency(at.employerMatch * householdMult)}${suffix}`}
                            />
                          </>
                        ) : (
                          <div
                            className={`${accountColor(at.categoryKey)} h-2 rounded-full`}
                            style={{ width: "100%" }}
                            title={`${formatCurrency(at.employeeContrib * householdMult)}${suffix}`}
                          />
                        )}
                      </div>
                      <div className="text-caption mt-0.5 flex justify-between">
                        <span className="text-faint">No IRS limit</span>
                        {at.employerMatch > 0 && (
                          <span
                            className={`${accountTextColor(at.categoryKey)} font-medium`}
                          >
                            +{formatCurrency(at.employerMatch * householdMult)}
                            {suffix} {at.employerMatchLabel}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="border-subtle mt-3 space-y-2 border-t pt-3">
        {/* Labels share one row and figures the next (subgrid), so a label
            that wraps — "Total (retirement only)" — doesn't push its
            figures below the others. */}
        <div className="grid grid-cols-3 gap-x-3 gap-y-0.5">
          {footer.map((f) => {
            const [main, alt] = excludeMatch
              ? [f.without, f.with]
              : [f.with, f.without];
            return (
              <div key={f.key} className="row-span-2 grid grid-rows-subgrid">
                <p className="text-caption text-faint self-end tracking-wide uppercase">
                  {f.label}
                </p>
                <div className="text-xs">
                  <span className="text-primary font-semibold">
                    {formatCurrency(main * householdMult)}
                  </span>
                  {alt !== main && (
                    <span className="text-muted block">
                      {formatCurrency(alt * householdMult)}{" "}
                      {excludeMatch ? "w/ match" : "w/o match"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {pace && pace.total.saved > 0 && (
          <p className="text-caption text-muted flex flex-wrap items-center justify-between gap-x-2">
            <span>
              Saved so far this year{" "}
              <span className="text-primary font-medium">
                {formatCurrency(pace.total.saved)}
              </span>
              {pace.total.unposted > 0 &&
                ` (+${formatCurrency(pace.total.unposted)} on its way)`}
            </span>
            <PaceStatusText status={pace.total.status} />
          </p>
        )}
      </div>
    </Card>
  );
}

export const ContributionsCard = memo(ContributionsCardImpl);
