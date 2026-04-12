"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useScenario } from "@/lib/context/scenario-context";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import {
  accountColor,
  accountMatchColor,
  accountBorderColor,
  accountTextColor,
} from "@/lib/utils/colors";
import {
  ContribPeriodToggle,
  getContribMultiplier,
  getPeriodSuffix,
  type ContribPeriod,
} from "@/components/ui/contrib-period-toggle";
import { FundingBar } from "./funding-bar";
import {
  categoriesWithIrsLimit,
  getAccountTypeConfig,
  isRetirementParent,
  isPortfolioParent,
} from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";

export function ContributionSnapshot() {
  const { viewMode } = useScenario();
  const [activeProfileId] = usePersistedSetting<number | null>(
    "active_contrib_profile_id",
    null,
  );
  const contribInput =
    activeProfileId != null
      ? { contributionProfileId: activeProfileId }
      : undefined;
  const { data, isLoading, error } =
    trpc.contribution.computeSummary.useQuery(contribInput);
  const [contribPeriod, setContribPeriod] = useState<ContribPeriod>("annual");

  if (isLoading)
    return (
      <div className="animate-pulse h-48 bg-surface-elevated rounded-lg" />
    );
  if (error)
    return (
      <p className="text-red-500 text-sm">
        Failed to load contribution snapshot
      </p>
    );
  if (!data?.people?.length) return null;

  const { people, jointAccountTypes = [], jointTotals } = data;
  const activePeople = people.filter((p) => p.accountTypes.length > 0);
  if (activePeople.length === 0 && jointAccountTypes.length === 0) return null;

  // Collect all unique account types across all people and joint accounts, in order
  const allTypes: string[] = [];
  for (const p of activePeople) {
    for (const at of p.accountTypes) {
      if (!allTypes.includes(at.accountType)) allTypes.push(at.accountType);
    }
  }
  for (const jat of jointAccountTypes) {
    if (!allTypes.includes(jat.accountType)) allTypes.push(jat.accountType);
  }

  // Use average periodsPerYear for household totals
  const avgPeriodsPerYear =
    activePeople.length > 0
      ? activePeople.reduce((s, p) => s + p.periodsPerYear!, 0) /
        activePeople.length
      : 26;
  const householdMult = getContribMultiplier(contribPeriod, avgPeriodsPerYear);

  // Household totals (apply multiplier) — include joint, non-overlapping groups by parentCategory
  const jt = jointTotals ?? { totalWithoutMatch: 0, totalWithMatch: 0 };
  const jointRetNoMatch = jointAccountTypes
    .filter((a) => isRetirementParent(a.parentCategory))
    .reduce((s, a) => s + a.employeeContrib, 0);
  const jointRetWithMatch = jointAccountTypes
    .filter((a) => isRetirementParent(a.parentCategory))
    .reduce((s, a) => s + a.totalContrib, 0);
  const jointPortNoMatch = jointAccountTypes
    .filter((a) => isPortfolioParent(a.parentCategory))
    .reduce((s, a) => s + a.employeeContrib, 0);
  const jointPortWithMatch = jointAccountTypes
    .filter((a) => isPortfolioParent(a.parentCategory))
    .reduce((s, a) => s + a.totalContrib, 0);

  // Household totals from server-computed view-mode values
  const householdRetNoMatch =
    (activePeople.reduce(
      (s, p) => s + p.totals.views[viewMode].retirementWithoutMatch,
      0,
    ) +
      jointRetNoMatch) *
    householdMult;
  const householdRetWithMatch =
    (activePeople.reduce(
      (s, p) => s + p.totals.views[viewMode].retirementWithMatch,
      0,
    ) +
      jointRetWithMatch) *
    householdMult;
  const householdPortNoMatch =
    (activePeople.reduce(
      (s, p) => s + p.totals.views[viewMode].portfolioWithoutMatch,
      0,
    ) +
      jointPortNoMatch) *
    householdMult;
  const householdPortWithMatch =
    (activePeople.reduce(
      (s, p) => s + p.totals.views[viewMode].portfolioWithMatch,
      0,
    ) +
      jointPortWithMatch) *
    householdMult;
  const householdTotalNoMatch =
    (activePeople.reduce(
      (s, p) => s + p.totals.views[viewMode].totalWithoutMatch,
      0,
    ) +
      jt.totalWithoutMatch) *
    householdMult;
  const householdTotalWithMatch =
    (activePeople.reduce(
      (s, p) => s + p.totals.views[viewMode].totalWithMatch,
      0,
    ) +
      jt.totalWithMatch) *
    householdMult;

  const periodSuffix = getPeriodSuffix(contribPeriod);

  return (
    <div className="mt-10 pt-8 border-t-2">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-7 bg-indigo-500 rounded-full" />
          <h2 className="text-xl font-bold text-primary">
            Household Contribution Snapshot
          </h2>
        </div>
        <ContribPeriodToggle
          value={contribPeriod}
          onChange={setContribPeriod}
        />
      </div>

      {/* Color legend */}
      <div className="flex flex-wrap items-center gap-3 mb-4 text-[10px] text-muted">
        <span className="font-medium text-muted">Account types:</span>
        <span className="flex items-center gap-1">
          <span className={`w-2 h-2 rounded ${accountColor("401k")}`} />
          401k — employer-sponsored retirement
        </span>
        <span className="flex items-center gap-1">
          <span className={`w-2 h-2 rounded ${accountColor("ira")}`} />
          IRA — individual retirement
        </span>
        <span className="flex items-center gap-1">
          <span className={`w-2 h-2 rounded ${accountColor("hsa")}`} />
          HSA — health savings (tax-free)
        </span>
        <span className="flex items-center gap-1">
          <span className={`w-2 h-2 rounded ${accountColor("brokerage")}`} />
          Brokerage — taxable investment
        </span>
        <span className="flex items-center gap-1">
          <span className={`w-2 h-2 rounded ${accountColor("espp")}`} />
          ESPP — employee stock purchase
        </span>
      </div>

      {/* Account type cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {allTypes.map((type) => {
          // Look up config-driven display properties from the first matching account
          const firstAt =
            activePeople
              .flatMap((p) => p.accountTypes)
              .find((a) => a.accountType === type) ??
            jointAccountTypes.find((a) => a.accountType === type);
          const hasDiscountBar = firstAt?.hasDiscountBar ?? false;
          const employerMatchLabel = firstAt?.employerMatchLabel ?? "match";
          const categoryKey = firstAt?.categoryKey ?? type;
          // Use categoryKey (raw DB category) for config lookups, accountType is display label
          const hasLimit = categoriesWithIrsLimit().includes(
            categoryKey as AccountCategory,
          );
          const isJoint =
            activePeople.some(
              (p) =>
                p.accountTypes.find((a) => a.accountType === type)?.isJoint,
            ) || jointAccountTypes.some((a) => a.accountType === type);
          // Whether employer match counts toward IRS limit (config-driven, e.g. HSA = true)
          const matchCountsTowardLimit = hasLimit
            ? getAccountTypeConfig(categoryKey as AccountCategory)
                .matchCountsTowardLimit
            : false;

          return (
            <div
              key={type}
              className={`bg-surface-primary border rounded-xl p-4 shadow-sm border-l-4 ${accountBorderColor(categoryKey)}`}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-primary">
                  {type}
                  {isJoint && (
                    <span className="text-xs text-faint font-normal ml-1">
                      (Joint)
                    </span>
                  )}
                  {(() => {
                    const cfg = hasLimit
                      ? getAccountTypeConfig(categoryKey as AccountCategory)
                      : null;
                    const famKey = cfg?.irsLimitKeys?.coverageVariant;
                    return famKey &&
                      activePeople.some(
                        (p) =>
                          p.accountTypes.find((a) => a.accountType === type)
                            ?.limit === data.limits[famKey],
                      ) ? (
                      <span className="text-xs text-faint font-normal ml-1">
                        (Family)
                      </span>
                    ) : null;
                  })()}
                </h3>
              </div>

              {/* Joint accounts: show once without per-person breakdown */}
              {isJoint &&
                (() => {
                  // Use joint account data from household-level response
                  const jat = jointAccountTypes.find(
                    (a) => a.accountType === type,
                  );
                  if (!jat) return null;
                  const totalEmployee = jat.employeeContrib * householdMult;
                  const totalMatch = jat.employerMatch * householdMult;
                  return (
                    <div className="mb-3">
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="font-medium">
                          {formatCurrency(totalEmployee)}
                          {periodSuffix}
                        </span>
                        {totalMatch > 0 && (
                          <span className="text-sm text-muted">
                            +{formatCurrency(totalMatch)}{" "}
                            <span className="text-xs text-faint">
                              {employerMatchLabel}
                            </span>
                          </span>
                        )}
                      </div>
                      {/* Bar for joint accounts */}
                      {hasDiscountBar &&
                      jat.employerMatch > 0 &&
                      jat.employeeContrib > 0 ? (
                        <div className="mt-1.5">
                          <div className="w-full bg-surface-strong rounded-full h-2 relative">
                            <div
                              className={`${accountColor(categoryKey)} h-2 rounded-l-full transition-all absolute left-0 top-0`}
                              style={{
                                width: `${(jat.employeeContrib / (jat.employeeContrib + jat.employerMatch)) * 100}%`,
                              }}
                              title={`Your cost: ${formatCurrency(totalEmployee)}${periodSuffix}`}
                            />
                            <div
                              className={`${accountMatchColor(categoryKey)} h-2 rounded-r-full transition-all absolute top-0`}
                              style={{
                                left: `${(jat.employeeContrib / (jat.employeeContrib + jat.employerMatch)) * 100}%`,
                                width: `${(jat.employerMatch / (jat.employeeContrib + jat.employerMatch)) * 100}%`,
                              }}
                              title={`${employerMatchLabel}: ${formatCurrency(totalMatch)}${periodSuffix}`}
                            />
                          </div>
                          <div className="flex justify-between text-[10px] mt-0.5">
                            <span className={accountTextColor(categoryKey)}>
                              Total value:{" "}
                              {formatCurrency(
                                (jat.employeeContrib + jat.employerMatch) *
                                  householdMult,
                              )}
                              {periodSuffix}
                            </span>
                            <span
                              className={`${accountTextColor(categoryKey)} font-medium`}
                            >
                              +
                              {formatPercent(
                                jat.employerMatch / jat.employeeContrib,
                              )}{" "}
                              {employerMatchLabel}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-1.5">
                          <div className="w-full bg-surface-strong rounded-full h-2 relative">
                            {jat.employerMatch > 0 ? (
                              <>
                                <div
                                  className={`${accountColor(categoryKey)} h-2 rounded-l-full absolute left-0 top-0`}
                                  style={{
                                    width: `${(jat.employeeContrib / (jat.employeeContrib + jat.employerMatch)) * 100}%`,
                                  }}
                                  title={`You: ${formatCurrency(totalEmployee)}${periodSuffix}`}
                                />
                                <div
                                  className={`${accountMatchColor(categoryKey)} h-2 rounded-r-full absolute top-0`}
                                  style={{
                                    left: `${(jat.employeeContrib / (jat.employeeContrib + jat.employerMatch)) * 100}%`,
                                    width: `${(jat.employerMatch / (jat.employeeContrib + jat.employerMatch)) * 100}%`,
                                  }}
                                  title={`${employerMatchLabel}: ${formatCurrency(totalMatch)}${periodSuffix}`}
                                />
                              </>
                            ) : (
                              <div
                                className={`${accountColor(categoryKey)} h-2 rounded-full`}
                                style={{ width: "100%" }}
                                title={`${formatCurrency(totalEmployee)}${periodSuffix}`}
                              />
                            )}
                          </div>
                          <div className="flex justify-between text-[10px] mt-0.5">
                            <span className="text-faint">No IRS limit</span>
                            {jat.employerMatch > 0 && (
                              <span
                                className={`${accountTextColor(categoryKey)} font-medium`}
                              >
                                +{formatCurrency(totalMatch)}
                                {periodSuffix} {employerMatchLabel}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

              {!isJoint &&
                activePeople.map((p) => {
                  const at = p.accountTypes.find((a) => a.accountType === type);
                  const mult = getContribMultiplier(
                    contribPeriod,
                    p.periodsPerYear!,
                  );
                  if (!at) {
                    // Show "Covered via X" note for household-limit categories when this person doesn't contribute directly
                    const typeCfg = hasLimit
                      ? getAccountTypeConfig(categoryKey as AccountCategory)
                      : null;
                    if (typeCfg?.isHouseholdLimit) {
                      const hsaContributor = activePeople.find((op) =>
                        op.accountTypes.some((a) => a.accountType === type),
                      );
                      if (hsaContributor) {
                        return (
                          <div key={p.person.id} className="mb-3 last:mb-0">
                            {activePeople.length > 1 && (
                              <p className="text-xs text-faint uppercase tracking-wide mb-1">
                                {p.person.name}
                              </p>
                            )}
                            <p className="text-xs text-faint italic">
                              Covered via {hsaContributor.person.name}
                            </p>
                          </div>
                        );
                      }
                    }
                    return null;
                  }

                  // Compute match percentage of the limit for the funding bar
                  const matchPctOfLimit =
                    hasLimit && at.limit > 0 && at.employerMatch > 0
                      ? at.employerMatch / at.limit
                      : undefined;

                  return (
                    <div key={p.person.id} className="mb-3 last:mb-0">
                      {activePeople.length > 1 && (
                        <p className="text-xs text-faint uppercase tracking-wide mb-1">
                          {p.person.name}
                        </p>
                      )}

                      {/* Employee amount */}
                      <div className="flex items-baseline justify-between text-sm">
                        <div>
                          <span className="font-medium">
                            {formatCurrency(at.employeeContrib * mult)}
                          </span>
                          {at.currentPctOfSalary !== null &&
                            contribPeriod === "annual" && (
                              <span className="text-xs text-faint ml-1">
                                ({Math.round(at.currentPctOfSalary)}%)
                              </span>
                            )}
                          {at.bonusContrib > 0 && (
                            <span
                              className="text-xs text-amber-600 ml-0.5"
                              title="Incl. bonus"
                            >
                              *
                            </span>
                          )}
                        </div>
                        {at.employerMatch > 0 && (
                          <span className="text-sm text-muted">
                            +{formatCurrency(at.employerMatch * mult)}
                            <span className="text-xs text-faint ml-0.5">
                              {employerMatchLabel}
                            </span>
                          </span>
                        )}
                      </div>

                      {/* Funding bar -- always shows annual funding % regardless of period toggle */}
                      {hasLimit && (
                        <div className="mt-1.5">
                          <FundingBar
                            pct={at.views[viewMode].fundingPct}
                            matchPct={matchPctOfLimit}
                            matchCountsTowardLimit={matchCountsTowardLimit}
                            accountType={categoryKey}
                          />
                          <div className="flex justify-between text-xs mt-0.5">
                            <span
                              className={
                                at.views[viewMode].fundingPct > 1
                                  ? "text-red-600 font-medium"
                                  : at.views[viewMode].fundingPct >= 1
                                    ? "text-green-600 font-medium"
                                    : "text-muted"
                              }
                            >
                              {formatPercent(at.views[viewMode].fundingPct)} of{" "}
                              {formatCurrency(at.limit)}
                              {at.views[viewMode].fundingPct > 1 && (
                                <span className="ml-1 text-[10px] bg-red-100 text-red-700 px-1 rounded">
                                  Over limit
                                </span>
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
                            <p className="text-[10px] text-blue-500 mt-0.5">
                              Match
                              {matchCountsTowardLimit
                                ? " counts toward IRS limit"
                                : " does not count toward IRS limit"}
                            </p>
                          )}
                          {at.views[viewMode].fundingPct > 1 && (
                            <p className="text-[10px] text-red-600 mt-0.5">
                              Over by{" "}
                              {formatCurrency(
                                (at.employeeContrib - at.limit) * mult,
                              )}
                              {periodSuffix} — reduce to avoid excess
                              contribution
                            </p>
                          )}
                          {at.views[viewMode].fundingPct <= 1 &&
                            at.views[viewMode].pctOfSalaryToMax !== null &&
                            Math.floor(at.views[viewMode].pctOfSalaryToMax) >
                              0 && (
                              <p className="text-[10px] text-amber-600 mt-0.5">
                                Need +
                                {Math.floor(
                                  at.views[viewMode].pctOfSalaryToMax,
                                )}
                                % to max
                              </p>
                            )}
                          {at.views[viewMode].fundingPct <= 1 &&
                            at.views[viewMode].pctOfSalaryToMax !== null &&
                            Math.floor(at.views[viewMode].pctOfSalaryToMax) ===
                              0 && (
                              <p className="text-[10px] text-green-600 mt-0.5">
                                Maxed out
                              </p>
                            )}
                          {/* Bonus 401k note */}
                          {at.bonusContrib > 0 && (
                            <p className="text-[10px] text-amber-600 mt-0.5">
                              * Includes ~
                              {formatCurrency(at.bonusContrib * mult)}
                              {periodSuffix} estimated 401k from bonus
                            </p>
                          )}
                          {/* Trad/Roth split */}
                          {(at.tradContrib > 0 || at.taxFreeContrib > 0) &&
                            at.tradContrib !== at.employeeContrib &&
                            at.taxFreeContrib !== at.employeeContrib && (
                              <div className="flex gap-2 text-[10px] text-faint mt-0.5">
                                {at.tradContrib > 0 && (
                                  <span>
                                    Pre-Tax:{" "}
                                    {formatCurrency(at.tradContrib * mult)}
                                  </span>
                                )}
                                {at.taxFreeContrib > 0 && (
                                  <span>
                                    Tax-Free:{" "}
                                    {formatCurrency(at.taxFreeContrib * mult)}
                                  </span>
                                )}
                              </div>
                            )}
                        </div>
                      )}

                      {/* Non-limited accounts (ESPP, Brokerage, etc.) */}
                      {!hasLimit && (
                        <div className="mt-1.5">
                          {/* Discount bar (ESPP-style) — config-driven via hasDiscountBar */}
                          {hasDiscountBar &&
                            at.employerMatch > 0 &&
                            at.employeeContrib > 0 && (
                              <>
                                <div className="w-full bg-surface-strong rounded-full h-2 relative">
                                  <div
                                    className={`${accountColor(categoryKey)} h-2 rounded-l-full transition-all absolute left-0 top-0`}
                                    style={{
                                      width: `${(at.employeeContrib / (at.employeeContrib + at.employerMatch)) * 100}%`,
                                    }}
                                    title={`Your cost: ${formatCurrency(at.employeeContrib * mult)}${periodSuffix}`}
                                  />
                                  <div
                                    className={`${accountMatchColor(categoryKey)} h-2 rounded-r-full transition-all absolute top-0`}
                                    style={{
                                      left: `${(at.employeeContrib / (at.employeeContrib + at.employerMatch)) * 100}%`,
                                      width: `${(at.employerMatch / (at.employeeContrib + at.employerMatch)) * 100}%`,
                                    }}
                                    title={`${employerMatchLabel}: ${formatCurrency(at.employerMatch * mult)}${periodSuffix}`}
                                  />
                                </div>
                                <div className="flex justify-between text-[10px] mt-0.5">
                                  <span
                                    className={accountTextColor(categoryKey)}
                                  >
                                    Total value:{" "}
                                    {formatCurrency(
                                      (at.employeeContrib + at.employerMatch) *
                                        mult,
                                    )}
                                    {periodSuffix}
                                  </span>
                                  <span
                                    className={`${accountTextColor(categoryKey)} font-medium`}
                                  >
                                    +
                                    {formatPercent(
                                      at.employerMatch / at.employeeContrib,
                                    )}{" "}
                                    {employerMatchLabel}
                                  </span>
                                </div>
                              </>
                            )}
                          {/* Solid bar for non-discount accounts */}
                          {!hasDiscountBar && (
                            <div className="w-full bg-surface-strong rounded-full h-2 relative">
                              {at.employerMatch > 0 ? (
                                <>
                                  <div
                                    className={`${accountColor(categoryKey)} h-2 rounded-l-full absolute left-0 top-0`}
                                    style={{
                                      width: `${(at.employeeContrib / (at.employeeContrib + at.employerMatch)) * 100}%`,
                                    }}
                                    title={`You: ${formatCurrency(at.employeeContrib * mult)}${periodSuffix}`}
                                  />
                                  <div
                                    className={`${accountMatchColor(categoryKey)} h-2 rounded-r-full absolute top-0`}
                                    style={{
                                      left: `${(at.employeeContrib / (at.employeeContrib + at.employerMatch)) * 100}%`,
                                      width: `${(at.employerMatch / (at.employeeContrib + at.employerMatch)) * 100}%`,
                                    }}
                                    title={`${employerMatchLabel}: ${formatCurrency(at.employerMatch * mult)}${periodSuffix}`}
                                  />
                                </>
                              ) : (
                                <div
                                  className={`${accountColor(categoryKey)} h-2 rounded-full`}
                                  style={{ width: "100%" }}
                                  title={`${formatCurrency(at.employeeContrib * mult)}${periodSuffix}`}
                                />
                              )}
                            </div>
                          )}
                          {/* No limit note + match info */}
                          <div className="flex justify-between text-[10px] mt-0.5">
                            <span className="text-faint">No IRS limit</span>
                            {at.employerMatch > 0 && (
                              <span
                                className={`${accountTextColor(categoryKey)} font-medium`}
                              >
                                +{formatCurrency(at.employerMatch * mult)}
                                {periodSuffix} {employerMatchLabel}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>

      {/* Household totals */}
      {viewMode === "blended" && (
        <p className="text-xs text-amber-600 mb-2">
          Year-End Estimate: actual YTD from performance + projected remaining
        </p>
      )}
      <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-100 rounded-xl p-5 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-xs text-faint uppercase tracking-wide mb-1">
            Retirement
            <HelpTip text="Accounts with parentCategory 'Retirement': 401k, IRA, HSA, and retirement-tagged brokerage." />
          </p>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-primary">
              {formatCurrency(householdRetNoMatch)}
            </span>
            <span className="text-muted">
              {formatCurrency(householdRetWithMatch)} w/ match
            </span>
          </div>
        </div>
        <div>
          <p className="text-xs text-faint uppercase tracking-wide mb-1">
            Brokerage
            <HelpTip text="Non-retirement investment accounts: brokerage, ESPP, and other taxable accounts outside the retirement nest egg." />
          </p>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-primary">
              {formatCurrency(householdPortNoMatch)}
            </span>
            <span className="text-muted">
              {formatCurrency(householdPortWithMatch)} w/ match
            </span>
          </div>
        </div>
        <div>
          <p className="text-xs text-faint uppercase tracking-wide mb-1">
            Total Portfolio
            <HelpTip text="All contributions combined: Retirement + Brokerage." />
          </p>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-primary">
              {formatCurrency(householdTotalNoMatch)}
            </span>
            <span className="text-muted">
              {formatCurrency(householdTotalWithMatch)} w/ match
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
