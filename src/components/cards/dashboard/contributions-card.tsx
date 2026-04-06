"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import {
  accountColor,
  accountMatchColor,
  accountTextColor,
  taxTypeLabel,
} from "@/lib/utils/colors";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useSalaryOverrides } from "@/lib/hooks/use-salary-overrides";
import { useScenario } from "@/lib/context/scenario-context";
import {
  ContribPeriodToggle,
  getContribMultiplier,
  getPeriodSuffix,
  type ContribPeriod,
} from "@/components/ui/contrib-period-toggle";
import {
  getAllCategories,
  getAccountTypeConfig,
  isRetirementParent,
  isPortfolioParent,
} from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";
import { LoadingCard, ErrorCard } from "./utils";

function FundingBar({
  pct,
  matchPct,
  matchCountsTowardLimit,
  accountType,
}: {
  pct: number;
  matchPct?: number;
  matchCountsTowardLimit?: boolean;
  accountType?: string;
}) {
  const showMatchBeyond = (matchPct ?? 0) > 0 && !matchCountsTowardLimit;
  const employeeClamped = Math.min(pct, 1);
  const totalPct = showMatchBeyond ? pct + (matchPct ?? 0) : pct;
  const typeColor = accountType ? accountColor(accountType) : null;
  const color =
    pct > 1
      ? "bg-red-500"
      : (typeColor ??
        (pct >= 1
          ? "bg-green-500"
          : pct >= 0.75
            ? "bg-blue-500"
            : pct >= 0.5
              ? "bg-yellow-500"
              : "bg-red-400"));
  const matchBarColor = accountType
    ? accountMatchColor(accountType)
    : "bg-blue-300/60";

  if (!showMatchBeyond) {
    return (
      <div className="w-full bg-surface-strong rounded-full h-2 relative">
        <div
          className={`${color} h-2 rounded-full transition-all`}
          style={{ width: `${employeeClamped * 100}%` }}
          title={`Employee contribution: ${formatPercent(pct)} of IRS limit`}
        />
        {/* IRS limit marker at 100% */}
        <div
          className="absolute top-[-2px] h-[12px] w-[2px] bg-gray-600"
          style={{ left: "100%" }}
          title="100% IRS annual limit"
        />
      </div>
    );
  }

  const scale = totalPct > 1 ? 1 / totalPct : 1;
  const employeeWidth = employeeClamped * scale * 100;
  const matchWidth = (matchPct ?? 0) * scale * 100;
  const limitPosition = 1 * scale * 100;

  return (
    <div className="w-full bg-surface-strong rounded-full h-2 relative">
      <div
        className={`${color} h-2 rounded-l-full transition-all absolute left-0 top-0`}
        style={{ width: `${employeeWidth}%` }}
        title={`Employee contribution: ${formatPercent(pct)} of IRS limit`}
      />
      <div
        className={`${matchBarColor} h-2 rounded-r-full transition-all absolute top-0`}
        style={{ left: `${employeeWidth}%`, width: `${matchWidth}%` }}
        title={`Employer match (does not count toward IRS limit)`}
      />
      <div
        className="absolute top-[-2px] h-[12px] w-[2px] bg-gray-600"
        style={{ left: `${limitPosition}%` }}
        title="100% IRS annual limit"
      />
    </div>
  );
}

export function ContributionsCard() {
  const { viewMode } = useScenario();
  const isYtd = viewMode === "ytd";
  const salaryOverrides = useSalaryOverrides();
  const [activeContribProfileId] = usePersistedSetting<number | null>(
    "active_contrib_profile_id",
    null,
  );
  const contribInput = {
    ...(salaryOverrides.length > 0 ? { salaryOverrides } : {}),
    ...(activeContribProfileId != null
      ? { contributionProfileId: activeContribProfileId }
      : {}),
  } as Parameters<typeof trpc.contribution.computeSummary.useQuery>[0];
  const { data, isLoading, error } =
    trpc.contribution.computeSummary.useQuery(contribInput);
  const [contribPeriod, setContribPeriod] = useState<ContribPeriod>("annual");
  if (isLoading) return <LoadingCard title="Contributions" />;
  if (error)
    return <ErrorCard title="Contributions" message="Failed to load" />;

  const people = data?.people?.filter((d) => d.accountTypes.length > 0) ?? [];
  // YTD scaling for household totals
  const ytdRatio = (d: (typeof people)[0]) =>
    d.periodsPerYear > 0 ? d.periodsElapsedYtd / d.periodsPerYear : 0;
  const avgYtdRatio =
    people.length > 0
      ? people.reduce((s, d) => s + ytdRatio(d), 0) / people.length
      : 0;
  const ytdScale = isYtd ? avgYtdRatio : 1;

  const jointAts = data?.jointAccountTypes ?? [];
  // Retirement vs portfolio vs total (from tRPC response, plus joint) — non-overlapping by parentCategory
  const jt = data?.jointTotals ?? { totalWithoutMatch: 0, totalWithMatch: 0 };
  const jointRetirement = jointAts.filter((a) =>
    isRetirementParent(a.parentCategory),
  );
  const jointPortfolio = jointAts.filter((a) =>
    isPortfolioParent(a.parentCategory),
  );
  const jointRetNoMatch = jointRetirement.reduce(
    (s, a) => s + a.employeeContrib,
    0,
  );
  const jointRetWithMatch = jointRetirement.reduce(
    (s, a) => s + a.totalContrib,
    0,
  );
  const jointPortNoMatch = jointPortfolio.reduce(
    (s, a) => s + a.employeeContrib,
    0,
  );
  const jointPortWithMatch = jointPortfolio.reduce(
    (s, a) => s + a.totalContrib,
    0,
  );
  const householdRetNoMatch =
    people.reduce((s, p) => s + p.totals.retirementWithoutMatch, 0) +
    jointRetNoMatch;
  const householdRetWithMatch =
    people.reduce((s, p) => s + p.totals.retirementWithMatch, 0) +
    jointRetWithMatch;
  const householdPortNoMatch =
    people.reduce((s, p) => s + p.totals.portfolioWithoutMatch, 0) +
    jointPortNoMatch;
  const householdPortWithMatch =
    people.reduce((s, p) => s + p.totals.portfolioWithMatch, 0) +
    jointPortWithMatch;
  const householdTotalNoMatch =
    people.reduce((s, p) => s + p.totals.totalWithoutMatch, 0) +
    jt.totalWithoutMatch;
  const householdTotalWithMatch =
    people.reduce((s, p) => s + p.totals.totalWithMatch, 0) + jt.totalWithMatch;

  // Use average periodsPerYear for household-level multiplier
  const avgPeriodsPerYear =
    people.length > 0
      ? people.reduce((s, p) => s + p.periodsPerYear!, 0) / people.length
      : 26;
  const householdMult = getContribMultiplier(contribPeriod, avgPeriodsPerYear);
  const suffix = getPeriodSuffix(contribPeriod);

  return (
    <Card
      title="Contributions"
      href="/paycheck"
      headerRight={
        <ContribPeriodToggle
          value={contribPeriod}
          onChange={setContribPeriod}
        />
      }
    >
      <div className="space-y-3">
        {people.map((p, pIdx) => {
          const mult = getContribMultiplier(contribPeriod, p.periodsPerYear!);
          return (
            <div
              key={p.person.id}
              className={pIdx > 0 ? "pt-3 border-t border-subtle" : ""}
            >
              <p className="text-xs font-medium text-muted uppercase mb-1">
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
                  const matchPctOfLimit =
                    hasLimit && at.employerMatch > 0
                      ? at.employerMatch / at.limit
                      : undefined;

                  return (
                    <div key={at.accountType}>
                      {/* Account type + employee amount + employer match */}
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="text-muted font-medium">
                          {at.accountType}
                          {at.isJoint && (
                            <span className="text-faint text-[10px] font-normal ml-1">
                              (Joint)
                            </span>
                          )}
                        </span>
                        <div className="text-right">
                          <span className="text-primary font-medium">
                            {formatCurrency(at.employeeContrib * mult)}
                          </span>
                          {at.currentPctOfSalary !== null &&
                            contribPeriod === "annual" && (
                              <span className="text-faint text-[10px] ml-1">
                                ({Math.round(at.currentPctOfSalary)}%)
                              </span>
                            )}
                        </div>
                      </div>

                      {/* Funding bar with IRS limit marker — always shows annual funding % */}
                      {hasLimit && (
                        <div className="mt-1">
                          <FundingBar
                            pct={at.fundingPct}
                            matchPct={matchPctOfLimit}
                            matchCountsTowardLimit={matchCountsTowardLimit}
                            accountType={at.categoryKey}
                          />
                          <div className="flex justify-between text-[10px] mt-0.5">
                            <span
                              className={
                                at.fundingPct > 1
                                  ? "text-red-600 font-medium"
                                  : at.fundingPct >= 1
                                    ? "text-green-600 font-medium"
                                    : "text-muted"
                              }
                            >
                              {formatPercent(at.fundingPct)} of{" "}
                              {formatCurrency(at.limit)}
                              {at.fundingPct > 1 && (
                                <span className="ml-1 bg-red-100 text-red-700 px-1 rounded">
                                  Over
                                </span>
                              )}
                            </span>
                            {at.fundingMissing > 0 && (
                              <span className="text-red-500">
                                -{formatCurrency(at.fundingMissing * mult)}
                              </span>
                            )}
                          </div>
                          {/* Employer match IRS context */}
                          {at.employerMatch > 0 && (
                            <p className="text-[10px] text-blue-500 mt-0.5">
                              Match
                              {matchCountsTowardLimit
                                ? " counts toward IRS limit"
                                : " does not count toward IRS limit"}
                            </p>
                          )}
                          {/* Need +X% to max */}
                          {at.fundingPct <= 1 &&
                            at.pctOfSalaryToMax !== null &&
                            Math.floor(at.pctOfSalaryToMax) > 0 && (
                              <p className="text-[10px] text-amber-600 mt-0.5">
                                Need +{Math.floor(at.pctOfSalaryToMax)}% to max
                              </p>
                            )}
                          {at.fundingPct <= 1 &&
                            at.pctOfSalaryToMax !== null &&
                            Math.floor(at.pctOfSalaryToMax) === 0 && (
                              <p className="text-[10px] text-green-600 mt-0.5">
                                Maxed out
                              </p>
                            )}
                          {/* Bonus contrib note */}
                          {at.bonusContrib > 0 && (
                            <p className="text-[10px] text-amber-600 mt-0.5">
                              * Incl. ~{formatCurrency(at.bonusContrib * mult)}
                              {suffix} from bonus
                            </p>
                          )}
                          {/* Trad/Roth split */}
                          {(at.tradContrib > 0 || at.taxFreeContrib > 0) &&
                            at.tradContrib !== at.employeeContrib &&
                            at.taxFreeContrib !== at.employeeContrib && (
                              <div className="flex gap-2 text-[10px] text-faint mt-0.5">
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
                            <div className="w-full bg-surface-strong rounded-full h-2 relative">
                              <div
                                className={`${accountColor(at.categoryKey)} h-2 rounded-l-full transition-all absolute left-0 top-0`}
                                style={{
                                  width: `${(at.employeeContrib / (at.employeeContrib + at.employerMatch)) * 100}%`,
                                }}
                                title={`Your cost: ${formatCurrency(at.employeeContrib * mult)}${suffix}`}
                              />
                              <div
                                className={`${accountMatchColor(at.categoryKey)} h-2 rounded-r-full transition-all absolute top-0`}
                                style={{
                                  left: `${(at.employeeContrib / (at.employeeContrib + at.employerMatch)) * 100}%`,
                                  width: `${(at.employerMatch / (at.employeeContrib + at.employerMatch)) * 100}%`,
                                }}
                                title={`${at.employerMatchLabel}: ${formatCurrency(at.employerMatch * mult)}${suffix}`}
                              />
                            </div>
                            <div className="flex justify-between text-[10px] mt-0.5">
                              <span
                                className={accountTextColor(at.categoryKey)}
                              >
                                Value:{" "}
                                {formatCurrency(
                                  (at.employeeContrib + at.employerMatch) *
                                    mult,
                                )}
                                {suffix}
                              </span>
                              <span
                                className={`${accountTextColor(at.categoryKey)} font-medium`}
                              >
                                +
                                {formatPercent(
                                  at.employerMatch / at.employeeContrib,
                                )}{" "}
                                {at.employerMatchLabel}
                              </span>
                            </div>
                          </div>
                        )}

                      {/* Non-discount non-limited accounts: solid bar + match info */}
                      {!hasLimit && !at.hasDiscountBar && (
                        <div className="mt-1">
                          <div className="w-full bg-surface-strong rounded-full h-2 relative">
                            {at.employerMatch > 0 ? (
                              <>
                                <div
                                  className={`${accountColor(at.categoryKey)} h-2 rounded-l-full absolute left-0 top-0`}
                                  style={{
                                    width: `${(at.employeeContrib / (at.employeeContrib + at.employerMatch)) * 100}%`,
                                  }}
                                  title={`You: ${formatCurrency(at.employeeContrib * mult)}${suffix}`}
                                />
                                <div
                                  className={`${accountMatchColor(at.categoryKey)} h-2 rounded-r-full absolute top-0`}
                                  style={{
                                    left: `${(at.employeeContrib / (at.employeeContrib + at.employerMatch)) * 100}%`,
                                    width: `${(at.employerMatch / (at.employeeContrib + at.employerMatch)) * 100}%`,
                                  }}
                                  title={`${at.employerMatchLabel}: ${formatCurrency(at.employerMatch * mult)}${suffix}`}
                                />
                              </>
                            ) : (
                              <div
                                className={`${accountColor(at.categoryKey)} h-2 rounded-full`}
                                style={{ width: "100%" }}
                                title={`${formatCurrency(at.employeeContrib * mult)}${suffix}`}
                              />
                            )}
                          </div>
                          <div className="flex justify-between text-[10px] mt-0.5">
                            <span className="text-faint">No IRS limit</span>
                            {at.employerMatch > 0 && (
                              <span
                                className={`${accountTextColor(at.categoryKey)} font-medium`}
                              >
                                +{formatCurrency(at.employerMatch * mult)}
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
          <div className="pt-3 border-t border-subtle">
            <p className="text-xs font-medium text-muted uppercase mb-1">
              Joint
            </p>
            <div className="space-y-2.5">
              {jointAts.map((at) => (
                <div key={at.accountType}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-muted font-medium">
                      {at.accountType}
                    </span>
                    <span className="text-primary font-medium">
                      {formatCurrency(at.employeeContrib * householdMult)}
                      {suffix}
                    </span>
                  </div>
                  {/* Bar for joint accounts */}
                  {at.hasDiscountBar && at.employerMatch > 0 ? (
                    <div className="mt-1">
                      <div className="w-full bg-surface-strong rounded-full h-2 relative">
                        <div
                          className={`${accountColor(at.categoryKey)} h-2 rounded-l-full absolute left-0 top-0`}
                          style={{
                            width: `${(at.employeeContrib / (at.employeeContrib + at.employerMatch)) * 100}%`,
                          }}
                          title={`You: ${formatCurrency(at.employeeContrib * householdMult)}${suffix}`}
                        />
                        <div
                          className={`${accountMatchColor(at.categoryKey)} h-2 rounded-r-full absolute top-0`}
                          style={{
                            left: `${(at.employeeContrib / (at.employeeContrib + at.employerMatch)) * 100}%`,
                            width: `${(at.employerMatch / (at.employeeContrib + at.employerMatch)) * 100}%`,
                          }}
                          title={`${at.employerMatchLabel}: ${formatCurrency(at.employerMatch * householdMult)}${suffix}`}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] mt-0.5">
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
                          {formatPercent(at.employerMatch / at.employeeContrib)}{" "}
                          {at.employerMatchLabel}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1">
                      <div className="w-full bg-surface-strong rounded-full h-2 relative">
                        {at.employerMatch > 0 ? (
                          <>
                            <div
                              className={`${accountColor(at.categoryKey)} h-2 rounded-l-full absolute left-0 top-0`}
                              style={{
                                width: `${(at.employeeContrib / (at.employeeContrib + at.employerMatch)) * 100}%`,
                              }}
                              title={`You: ${formatCurrency(at.employeeContrib * householdMult)}${suffix}`}
                            />
                            <div
                              className={`${accountMatchColor(at.categoryKey)} h-2 rounded-r-full absolute top-0`}
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
                      <div className="flex justify-between text-[10px] mt-0.5">
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
      <div className="mt-3 pt-3 border-t border-subtle space-y-2">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] text-faint uppercase tracking-wide mb-0.5">
              Retirement
            </p>
            <div className="text-xs">
              <span className="font-semibold text-primary">
                {formatCurrency(householdRetNoMatch * householdMult * ytdScale)}
              </span>
              {householdRetWithMatch > householdRetNoMatch && (
                <span className="text-muted ml-1">
                  {formatCurrency(
                    householdRetWithMatch * householdMult * ytdScale,
                  )}{" "}
                  w/ match
                </span>
              )}
            </div>
          </div>
          <div>
            <p className="text-[10px] text-faint uppercase tracking-wide mb-0.5">
              Brokerage
            </p>
            <div className="text-xs">
              <span className="font-semibold text-primary">
                {formatCurrency(
                  householdPortNoMatch * householdMult * ytdScale,
                )}
              </span>
              {householdPortWithMatch > householdPortNoMatch && (
                <span className="text-muted ml-1">
                  {formatCurrency(
                    householdPortWithMatch * householdMult * ytdScale,
                  )}{" "}
                  w/ match
                </span>
              )}
            </div>
          </div>
          <div>
            <p className="text-[10px] text-faint uppercase tracking-wide mb-0.5">
              Total Portfolio{isYtd ? " (YTD)" : ""}
            </p>
            <div className="text-xs">
              <span className="font-semibold text-primary">
                {formatCurrency(
                  householdTotalNoMatch * householdMult * ytdScale,
                )}
              </span>
              {householdTotalWithMatch > householdTotalNoMatch && (
                <span className="text-muted ml-1">
                  {formatCurrency(
                    householdTotalWithMatch * householdMult * ytdScale,
                  )}{" "}
                  w/ match
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
