"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useScenario } from "@/lib/context/scenario-context";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { sumBy } from "@/lib/utils/math";
import { HelpTip } from "@/components/ui/help-tip";
import { Badge } from "@/components/ui/badge";
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
} from "@/lib/config/account-types";
import { useSavingsRateOptions } from "@/lib/hooks/use-savings-rate-options";
import {
  DEFAULT_HIGH_INCOME_THRESHOLD,
  OVER_LIMIT_THRESHOLD,
} from "@/lib/constants";
import { SK_HIGH_INCOME_THRESHOLD } from "@/lib/constants/settings-keys";
import {
  householdSavings,
  householdTotalCompensation,
  isHighIncomeHousehold,
  type HouseholdSavings,
  type SavingsGroup,
} from "@/lib/pure/contributions";
import type { AccountCategory } from "@/lib/config/account-types";
import { useEffectiveSalaryProfileId } from "@/lib/hooks/use-effective-salary-profile-id";

export function ContributionSnapshot() {
  const { viewMode } = useScenario();
  const [activeProfileId] = usePersistedSetting<number | null>(
    "active_contrib_profile_id",
    null,
  );
  const { queryInput: salaryProfileInput } = useEffectiveSalaryProfileId();
  const contribInput = {
    ...(activeProfileId != null
      ? { contributionProfileId: activeProfileId }
      : {}),
    ...salaryProfileInput,
  };
  const { data, isLoading, error } =
    trpc.contribution.computeSummary.useQuery(contribInput);
  const [contribPeriod, setContribPeriod] = useState<ContribPeriod>("annual");
  const [highIncomeThreshold] = usePersistedSetting<number>(
    SK_HIGH_INCOME_THRESHOLD,
    DEFAULT_HIGH_INCOME_THRESHOLD,
  );
  const { excludeMatch, includePortfolio } = useSavingsRateOptions(
    isHighIncomeHousehold(
      householdTotalCompensation(data?.people?.filter((d) => d.result) ?? []),
      highIncomeThreshold,
    ),
  );

  if (isLoading)
    return (
      <div className="bg-surface-elevated h-48 animate-pulse rounded-lg" />
    );
  if (error)
    return (
      <p className="text-sm text-red-500">
        Failed to load contribution snapshot
      </p>
    );
  if (!data?.people?.length) return null;

  const { people, jointAccountTypes = [] } = data;
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
      ? sumBy(activePeople, (p) => p.periodsPerYear!) / activePeople.length
      : 26;
  const householdMult = getContribMultiplier(contribPeriod, avgPeriodsPerYear);

  // Household totals: the same calculation as every savings rate
  // (householdSavings), with and without the match.
  const savingsOf = (withoutMatch: boolean) =>
    householdSavings(
      people.filter((d) => d.result),
      jointAccountTypes,
      viewMode,
      { excludeMatch: withoutMatch },
    );
  const savingsWith = savingsOf(false);
  const savingsWithout = savingsOf(true);
  const groupTotal = (sv: HouseholdSavings, g: SavingsGroup) =>
    sv.groups.find((x) => x.group === g)?.total ?? 0;
  const totals = [
    {
      key: "retirement",
      label: "Retirement",
      help: "Accounts with parentCategory 'Retirement': 401k, IRA, HSA, and retirement-tagged brokerage.",
      without: groupTotal(savingsWithout, "retirement"),
      with: groupTotal(savingsWith, "retirement"),
    },
    {
      key: "portfolio",
      label: "Brokerage",
      help: "Non-retirement investment accounts: brokerage, ESPP, and other taxable accounts outside the retirement nest egg.",
      without: groupTotal(savingsWithout, "portfolio"),
      with: groupTotal(savingsWith, "portfolio"),
    },
    {
      key: "total",
      label: includePortfolio ? "Total Portfolio" : "Total (retirement only)",
      help: includePortfolio
        ? "All contributions combined: Retirement + Brokerage."
        : "Retirement accounts only — Brokerage is switched off in the savings rate.",
      without: includePortfolio
        ? savingsWithout.total
        : groupTotal(savingsWithout, "retirement"),
      with: includePortfolio
        ? savingsWith.total
        : groupTotal(savingsWith, "retirement"),
    },
  ];

  const periodSuffix = getPeriodSuffix(contribPeriod);

  return (
    <div className="mt-10 border-t-2 pt-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-7 w-1.5 rounded-full bg-indigo-500" />
          <h2 className="text-primary text-xl font-bold">
            Household Contribution Snapshot
          </h2>
        </div>
        <ContribPeriodToggle
          value={contribPeriod}
          onChange={setContribPeriod}
        />
      </div>

      {/* Color legend */}
      <div className="text-caption text-muted mb-4 flex flex-wrap items-center gap-3">
        <span className="text-muted font-medium">Account types:</span>
        <span className="flex items-center gap-1">
          <span className={`h-2 w-2 rounded ${accountColor("401k")}`} />
          401k — employer-sponsored retirement
        </span>
        <span className="flex items-center gap-1">
          <span className={`h-2 w-2 rounded ${accountColor("ira")}`} />
          IRA — individual retirement
        </span>
        <span className="flex items-center gap-1">
          <span className={`h-2 w-2 rounded ${accountColor("hsa")}`} />
          HSA — health savings (tax-free)
        </span>
        <span className="flex items-center gap-1">
          <span className={`h-2 w-2 rounded ${accountColor("brokerage")}`} />
          Brokerage — taxable investment
        </span>
        <span className="flex items-center gap-1">
          <span className={`h-2 w-2 rounded ${accountColor("espp")}`} />
          ESPP — employee stock purchase
        </span>
      </div>

      {/* Account type cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
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
              className={`bg-surface-primary rounded-xl border border-l-4 p-4 shadow-sm ${accountBorderColor(categoryKey)}`}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-primary font-semibold">
                  {type}
                  {isJoint && (
                    <span className="text-faint ml-1 text-xs font-normal">
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
                      <span className="text-faint ml-1 text-xs font-normal">
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
                          <span className="text-muted text-sm">
                            +{formatCurrency(totalMatch)}{" "}
                            <span className="text-faint text-xs">
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
                          <div className="bg-surface-strong relative h-2 w-full rounded-full">
                            <div
                              className={`${accountColor(categoryKey)} absolute top-0 left-0 h-2 rounded-l-full transition-all`}
                              style={{
                                width: `${(jat.employeeContrib / (jat.employeeContrib + jat.employerMatch)) * 100}%`,
                              }}
                              title={`Your cost: ${formatCurrency(totalEmployee)}${periodSuffix}`}
                            />
                            <div
                              className={`${accountMatchColor(categoryKey)} absolute top-0 h-2 rounded-r-full transition-all`}
                              style={{
                                left: `${(jat.employeeContrib / (jat.employeeContrib + jat.employerMatch)) * 100}%`,
                                width: `${(jat.employerMatch / (jat.employeeContrib + jat.employerMatch)) * 100}%`,
                              }}
                              title={`${employerMatchLabel}: ${formatCurrency(totalMatch)}${periodSuffix}`}
                            />
                          </div>
                          <div className="text-caption mt-0.5 flex justify-between">
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
                          <div className="bg-surface-strong relative h-2 w-full rounded-full">
                            {jat.employerMatch > 0 ? (
                              <>
                                <div
                                  className={`${accountColor(categoryKey)} absolute top-0 left-0 h-2 rounded-l-full`}
                                  style={{
                                    width: `${(jat.employeeContrib / (jat.employeeContrib + jat.employerMatch)) * 100}%`,
                                  }}
                                  title={`You: ${formatCurrency(totalEmployee)}${periodSuffix}`}
                                />
                                <div
                                  className={`${accountMatchColor(categoryKey)} absolute top-0 h-2 rounded-r-full`}
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
                          <div className="text-caption mt-0.5 flex justify-between">
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
                              <p className="text-faint mb-1 text-xs tracking-wide uppercase">
                                {p.person.name}
                              </p>
                            )}
                            <p className="text-faint text-xs italic">
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
                    hasLimit &&
                    at.limit > 0 &&
                    at.views[viewMode].employerMatch > 0
                      ? at.views[viewMode].employerMatch / at.limit
                      : undefined;

                  return (
                    <div key={p.person.id} className="mb-3 last:mb-0">
                      {activePeople.length > 1 && (
                        <p className="text-faint mb-1 text-xs tracking-wide uppercase">
                          {p.person.name}
                        </p>
                      )}

                      {/* Employee amount */}
                      <div className="flex items-baseline justify-between text-sm">
                        <div>
                          <span className="font-medium">
                            {formatCurrency(
                              at.views[viewMode].employeeContrib * mult,
                            )}
                          </span>
                          {at.currentPctOfSalary !== null && (
                            <span className="text-faint ml-1 text-xs">
                              ({Number(at.currentPctOfSalary.toFixed(1))}% of
                              pay)
                            </span>
                          )}
                          {at.bonusContrib > 0 && (
                            <span
                              className="ml-0.5 text-xs text-amber-600"
                              title="Incl. bonus"
                            >
                              *
                            </span>
                          )}
                        </div>
                        {at.employerMatch > 0 && (
                          <span className="text-muted text-sm">
                            +
                            {formatCurrency(
                              at.views[viewMode].employerMatch * mult,
                            )}
                            <span className="text-faint ml-0.5 text-xs">
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
                          <div className="mt-0.5 flex justify-between text-xs">
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
                              {at.overBy > 0 && (
                                <Badge color="red" size="sm" className="ml-1">
                                  Over limit
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
                          {/* What to fix — the configured contribution is
                              over the limit (figures show the capped
                              amount), or the account needs an owner or an
                              HSA coverage type. */}
                          {at.capMessages.map((m) => (
                            <p
                              key={m}
                              className={`text-caption mt-0.5 ${at.overBy > 0 ? "text-red-600" : "text-amber-600"}`}
                            >
                              {m}
                            </p>
                          ))}
                          {/* Employer match IRS context */}
                          {at.employerMatch > 0 && (
                            <p className="text-caption text-faint mt-0.5">
                              Match
                              {matchCountsTowardLimit
                                ? " counts toward IRS limit"
                                : " does not count toward IRS limit"}
                            </p>
                          )}
                          {at.views[viewMode].fundingPct >
                            OVER_LIMIT_THRESHOLD && (
                            <p className="text-caption mt-0.5 text-red-600">
                              Over by{" "}
                              {formatCurrency(
                                ((matchCountsTowardLimit
                                  ? at.views[viewMode].totalContrib
                                  : at.views[viewMode].employeeContrib) -
                                  at.limit) *
                                  mult,
                              )}
                              {periodSuffix} — reduce to avoid excess
                              contribution
                            </p>
                          )}
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
                                Maxed out
                              </p>
                            )}
                          {/* Bonus 401k note */}
                          {at.bonusContrib > 0 && (
                            <p className="text-caption mt-0.5 text-amber-600">
                              * Includes ~
                              {formatCurrency(at.bonusContrib * mult)}
                              {periodSuffix} estimated 401k from bonus
                            </p>
                          )}
                          {/* Trad/Roth split */}
                          {(at.tradContrib > 0 || at.taxFreeContrib > 0) &&
                            at.tradContrib !== at.employeeContrib &&
                            at.taxFreeContrib !== at.employeeContrib && (
                              <div className="text-caption text-faint mt-0.5 flex gap-2">
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
                                <div className="bg-surface-strong relative h-2 w-full rounded-full">
                                  <div
                                    className={`${accountColor(categoryKey)} absolute top-0 left-0 h-2 rounded-l-full transition-all`}
                                    style={{
                                      width: `${(at.employeeContrib / (at.employeeContrib + at.employerMatch)) * 100}%`,
                                    }}
                                    title={`Your cost: ${formatCurrency(at.views[viewMode].employeeContrib * mult)}${periodSuffix}`}
                                  />
                                  <div
                                    className={`${accountMatchColor(categoryKey)} absolute top-0 h-2 rounded-r-full transition-all`}
                                    style={{
                                      left: `${(at.employeeContrib / (at.employeeContrib + at.employerMatch)) * 100}%`,
                                      width: `${(at.employerMatch / (at.employeeContrib + at.employerMatch)) * 100}%`,
                                    }}
                                    title={`${employerMatchLabel}: ${formatCurrency(at.views[viewMode].employerMatch * mult)}${periodSuffix}`}
                                  />
                                </div>
                                <div className="text-caption mt-0.5 flex justify-between">
                                  <span
                                    className={accountTextColor(categoryKey)}
                                  >
                                    Total value:{" "}
                                    {formatCurrency(
                                      (at.views[viewMode].employeeContrib +
                                        at.views[viewMode].employerMatch) *
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
                            <div className="bg-surface-strong relative h-2 w-full rounded-full">
                              {at.employerMatch > 0 ? (
                                <>
                                  <div
                                    className={`${accountColor(categoryKey)} absolute top-0 left-0 h-2 rounded-l-full`}
                                    style={{
                                      width: `${(at.employeeContrib / (at.employeeContrib + at.employerMatch)) * 100}%`,
                                    }}
                                    title={`You: ${formatCurrency(at.views[viewMode].employeeContrib * mult)}${periodSuffix}`}
                                  />
                                  <div
                                    className={`${accountMatchColor(categoryKey)} absolute top-0 h-2 rounded-r-full`}
                                    style={{
                                      left: `${(at.employeeContrib / (at.employeeContrib + at.employerMatch)) * 100}%`,
                                      width: `${(at.employerMatch / (at.employeeContrib + at.employerMatch)) * 100}%`,
                                    }}
                                    title={`${employerMatchLabel}: ${formatCurrency(at.views[viewMode].employerMatch * mult)}${periodSuffix}`}
                                  />
                                </>
                              ) : (
                                <div
                                  className={`${accountColor(categoryKey)} h-2 rounded-full`}
                                  style={{ width: "100%" }}
                                  title={`${formatCurrency(at.views[viewMode].employeeContrib * mult)}${periodSuffix}`}
                                />
                              )}
                            </div>
                          )}
                          {/* No limit note + match info */}
                          <div className="text-caption mt-0.5 flex justify-between">
                            <span className="text-faint">No IRS limit</span>
                            {at.employerMatch > 0 && (
                              <span
                                className={`${accountTextColor(categoryKey)} font-medium`}
                              >
                                +
                                {formatCurrency(
                                  at.views[viewMode].employerMatch * mult,
                                )}
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
        <p className="mb-2 text-xs text-amber-600">
          Year-end estimate: actual so far this year (from Performance) plus the
          rest of the year projected
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-blue-50 p-5 text-sm md:grid-cols-3">
        {totals.map((t) => {
          const [main, alt] = excludeMatch
            ? [t.without, t.with]
            : [t.with, t.without];
          return (
            <div key={t.key}>
              <p className="text-faint mb-1 text-xs tracking-wide uppercase">
                {t.label}
                <HelpTip text={t.help} />
              </p>
              <div className="flex items-baseline gap-2">
                <span className="text-primary text-lg font-bold">
                  {formatCurrency(main * householdMult)}
                </span>
                {alt !== main && (
                  <span className="text-muted">
                    {formatCurrency(alt * householdMult)}{" "}
                    {excludeMatch ? "w/ match" : "w/o match"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
