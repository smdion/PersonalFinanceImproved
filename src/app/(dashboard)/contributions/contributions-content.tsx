"use client";

/** Client content for the Contributions page — prefetched by page.tsx. */

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useActiveContribProfile } from "@/lib/hooks/use-active-contrib-profile";
import { PageHeader } from "@/components/ui/page-header";
import { Toggle } from "@/components/ui/toggle";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatCurrency,
  formatPercent,
  formatSavingsRate,
} from "@/lib/utils/format";
import { safeDivide } from "@/lib/utils/math";
import { categoryChartHex, gainLossTextColor } from "@/lib/utils/colors";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { useScenario } from "@/lib/context/scenario-context";
import { DEFAULT_HIGH_INCOME_THRESHOLD } from "@/lib/constants";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useSavingsRateOptions } from "@/lib/hooks/use-savings-rate-options";
import { useRecommendations } from "@/lib/hooks/use-recommendations";
import { contributionsSummaryLine } from "@/lib/pure/plain-summary";
import { PlainSummary } from "@/components/ui/plain-summary";
import {
  householdSavings,
  type HouseholdSavings,
  type SavingsGroup,
} from "@/lib/pure/contributions";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { useEffectiveSalaryProfileId } from "@/lib/hooks/use-effective-salary-profile-id";

type PeriodMode = "annual" | "monthly" | "per-period";

function toDisplay(
  annual: number,
  periodsPerYear: number,
  mode: PeriodMode,
): number {
  if (mode === "monthly") return annual / 12;
  if (mode === "per-period") return annual / periodsPerYear;
  return annual;
}

function periodLabel(mode: PeriodMode): string {
  if (mode === "monthly") return "/mo";
  if (mode === "per-period") return "/period";
  return "/yr";
}

export function ContributionsContent() {
  const { viewMode } = useScenario();
  const user = useUser();
  const canEdit = hasPermission(user, "portfolio");
  const utils = trpc.useUtils();
  const { data: profiles } = trpc.contributionProfile.list.useQuery();
  const [period, setPeriod] = useState<PeriodMode>("annual");
  const [activeProfileId] = useActiveContribProfile();
  // Independent Salary Profile axis (the active profile).
  const { queryInput: salaryProfileInput } = useEffectiveSalaryProfileId();
  // the active profile — the primary summary below must stay
  // in sync with Paycheck/Budget's resolution instead of always reading raw
  // Live data (see docs/RULES.md "Profile Resolution"). This is distinct from
  // selectedProfileId below, which is a "compare against a specific other
  // profile" picker and deliberately stays local-only.
  const { profileId: effectiveActiveContribProfileId } = useEffectiveProfileId(
    "contribution",
    {
      validIds: profiles?.map((p) => p.id),
      localSelection: null,
      globalDefaultId: activeProfileId,
    },
  );
  const dataInput = {
    ...(effectiveActiveContribProfileId != null
      ? { contributionProfileId: effectiveActiveContribProfileId }
      : {}),
    ...salaryProfileInput,
  };
  const { data, isLoading } = trpc.contribution.computeSummary.useQuery(
    Object.keys(dataInput).length > 0 ? dataInput : undefined,
  );
  const setPriorYear =
    trpc.settings.contributionAccounts.setPriorYearAmount.useMutation({
      onSuccess: () => utils.contribution.computeSummary.invalidate(),
    });
  const [selectedProfileId, setSelectedProfileId] = useState<
    number | undefined
  >(activeProfileId ?? undefined);
  const [highIncomeThreshold] = usePersistedSetting<number>(
    "high_income_threshold",
    DEFAULT_HIGH_INCOME_THRESHOLD,
  );
  // Before the early returns (hooks): the switches are shared app-wide.
  const { excludeMatch, includePortfolio, toggleMatch, togglePortfolio } =
    useSavingsRateOptions(
      (data?.people ?? [])
        .filter((p) => p.salary > 0)
        .reduce((s, p) => s + (p.totalCompensation ?? p.salary), 0) >=
        highIncomeThreshold,
    );

  // The top paycheck to-do, for the plain-words line.
  const { recommendations } = useRecommendations();
  const nextPaycheckAction =
    recommendations.find((r) => r.area === "paycheck")?.action ?? null;

  const { data: profileData } = trpc.contribution.computeSummary.useQuery(
    { contributionProfileId: selectedProfileId },
    { enabled: !!selectedProfileId },
  );

  if (isLoading) {
    return (
      <div>
        <PageHeader
          title="Contributions"
          subtitle="Household contribution breakdown and savings rates"
        />
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const people = data?.people ?? [];
  const priorYearWindow = data?.priorYearWindow ?? null;

  if (!data || people.length === 0) {
    return (
      <div>
        <PageHeader
          title="Contributions"
          subtitle="Household contribution breakdown and savings rates"
        />
        <Card>
          <p className="text-muted py-8 text-center text-sm">
            No contribution accounts configured. Add contribution accounts on
            the Paycheck page.
          </p>
        </Card>
      </div>
    );
  }

  const activePeople = people.filter((p) => p.salary > 0);
  // Use totalCompensation (always includes bonus) for savings rate — matches projection page
  const combinedSalary = activePeople.reduce(
    (s, p) => s + (p.totalCompensation ?? p.salary),
    0,
  );

  const avgPeriodsPerYear =
    activePeople.length > 0
      ? activePeople.reduce((s, p) => s + p.periodsPerYear, 0) /
        activePeople.length
      : 26;

  // Household totals and rates: the same calculation as the Financial
  // Checkup (householdSavings — joint accounts per view; YTD divides by pay
  // earned so far), with and without the match so each card shows both.
  const jointAccountTypes = data?.jointAccountTypes ?? [];
  const jointTotals = {
    totalWithoutMatch: jointAccountTypes.reduce(
      (t, a) => t + a.views[viewMode].employeeContrib,
      0,
    ),
    totalWithMatch: jointAccountTypes.reduce(
      (t, a) => t + a.views[viewMode].totalContrib,
      0,
    ),
  };
  const savingsOf = (
    source: {
      people: typeof activePeople;
      joint: typeof jointAccountTypes;
    },
    withoutMatch: boolean,
  ) =>
    householdSavings(source.people, source.joint, viewMode, {
      excludeMatch: withoutMatch,
    });
  const current = { people: activePeople, joint: jointAccountTypes };
  const savingsWith = savingsOf(current, false);
  const savingsWithout = savingsOf(current, true);
  const group = (sv: HouseholdSavings, g: SavingsGroup) =>
    sv.groups.find((x) => x.group === g) ?? { total: 0, share: 0 };
  const totalRetirementWith = group(savingsWith, "retirement").total;
  const totalRetirementWithout = group(savingsWithout, "retirement").total;
  const totalPortfolioWith = group(savingsWith, "portfolio").total;
  const totalPortfolioWithout = group(savingsWithout, "portfolio").total;
  const totalWith = savingsWith.total;
  const totalWithout = savingsWithout.total;
  const totalEmployerMatch = totalWith - totalWithout;

  const pl = periodLabel(period);

  return (
    <div>
      <PageHeader
        title="Contributions"
        subtitle="Household contribution breakdown and savings rates"
      >
        <div className="flex items-center gap-3">
          {profiles && profiles.length > 0 && (
            // Which Contribution Profile this page shows — the active one
            // unless you pick another to look at (this page only).
            <label className="flex items-center gap-2">
              <span className="text-faint hidden text-xs sm:inline">
                Contribution Profile
              </span>
              <select
                value={selectedProfileId ?? activeProfileId ?? ""}
                onChange={(e) =>
                  setSelectedProfileId(
                    e.target.value ? parseInt(e.target.value) : undefined,
                  )
                }
                className="bg-surface-primary text-primary rounded border px-2 py-1 text-sm"
              >
                {activeProfileId == null && <option value="">None</option>}
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.id === activeProfileId ? " (active)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="bg-surface-elevated flex gap-1 rounded-full p-0.5">
            {(["annual", "monthly", "per-period"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setPeriod(m)}
                className={`rounded-full px-3 py-1 text-xs transition-colors ${
                  period === m
                    ? "bg-blue-600 text-white"
                    : "text-muted hover:text-primary"
                }`}
              >
                {m === "annual"
                  ? "Annual"
                  : m === "monthly"
                    ? "Monthly"
                    : "Per Period"}
              </button>
            ))}
          </div>
        </div>
      </PageHeader>

      {/* Prior-year contribution window banner */}
      {priorYearWindow && (
        <div className="bg-surface-elevated border-subtle mb-6 rounded-lg border px-4 py-3">
          <p className="text-secondary text-sm">
            <span className="text-primary font-medium">
              Prior-year contributions:
            </span>{" "}
            You can designate IRA and HSA contributions for tax year{" "}
            {priorYearWindow.priorYear} until {priorYearWindow.deadline}. Set
            prior-year amounts on individual accounts in the Portfolio settings.
          </p>
        </div>
      )}

      {/* What the savings rate counts — a household setting (also the
          Dashboard's), so it sits with the rates it changes, not with the
          page-wide controls. The tables below always show every account. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="text-muted">Savings rate counts:</span>
        <Toggle
          isChecked={!excludeMatch}
          onChange={toggleMatch}
          label="Employer match"
          size="xs"
        />
        <Toggle
          isChecked={includePortfolio}
          onChange={togglePortfolio}
          label="Portfolio"
          size="xs"
          title="Brokerage and other non-retirement savings"
        />
        <span className="text-faint">Also used on the Dashboard.</span>
      </div>

      {/* Household summary — rates from server (single source of truth) */}
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        {(() => {
          // Total counts Portfolio money only while the portfolio switch is on.
          const counted = (sv: HouseholdSavings) =>
            includePortfolio ? sv.total : group(sv, "retirement").total;
          const share = (n: number) =>
            safeDivide(n, savingsWith.compensation, 0);
          const hhRateWith = share(counted(savingsWith));
          const hhRateWithout = share(counted(savingsWithout));
          const retRateWith = group(savingsWith, "retirement").share;
          const retRateWithout = group(savingsWithout, "retirement").share;
          const portRateWith = group(savingsWith, "portfolio").share;
          const portRateWithout = group(savingsWithout, "portfolio").share;
          const isBlended = viewMode === "blended";
          const primary = excludeMatch ? "without" : "with";
          return (
            <>
              {viewMode === "projected" && (
                <div className="md:col-span-3">
                  <PlainSummary
                    text={contributionsSummaryLine({
                      rate: primary === "without" ? hhRateWithout : hhRateWith,
                      annualAmount: counted(
                        excludeMatch ? savingsWithout : savingsWith,
                      ),
                      matchIncluded: !excludeMatch,
                      includePortfolio,
                      nextAction: nextPaycheckAction,
                    })}
                  />
                </div>
              )}
              <SummaryCard
                label={`${isBlended ? "Total Savings (Est.)" : "Total Savings"}${includePortfolio ? "" : " — retirement only"}`}
                rate={primary === "without" ? hhRateWithout : hhRateWith}
                rateAlt={primary === "without" ? hhRateWith : hhRateWithout}
                altLabel={excludeMatch ? "w/ match" : "w/o match"}
                amount={toDisplay(
                  counted(excludeMatch ? savingsWithout : savingsWith),
                  avgPeriodsPerYear,
                  period,
                )}
                pl={pl}
                color="bg-blue-500"
              />
              <SummaryCard
                label={isBlended ? "Retirement (Est.)" : "Retirement"}
                rate={primary === "without" ? retRateWithout : retRateWith}
                rateAlt={primary === "without" ? retRateWith : retRateWithout}
                altLabel={excludeMatch ? "w/ match" : "w/o match"}
                amount={toDisplay(
                  excludeMatch ? totalRetirementWithout : totalRetirementWith,
                  avgPeriodsPerYear,
                  period,
                )}
                pl={pl}
                color="bg-emerald-500"
              />
              <SummaryCard
                label={isBlended ? "Portfolio (Est.)" : "Portfolio"}
                rate={primary === "without" ? portRateWithout : portRateWith}
                rateAlt={primary === "without" ? portRateWith : portRateWithout}
                altLabel={excludeMatch ? "w/ match" : "w/o match"}
                amount={toDisplay(
                  excludeMatch ? totalPortfolioWithout : totalPortfolioWith,
                  avgPeriodsPerYear,
                  period,
                )}
                pl={pl}
                color="bg-purple-500"
                note={includePortfolio ? undefined : "Not counted in the total"}
              />
            </>
          );
        })()}
      </div>

      {/* Employer match summary */}
      {totalEmployerMatch > 0 && (
        <Card title="Employer Match" className="mb-6">
          <div className="flex items-center gap-4 py-2">
            <div className="text-2xl font-bold text-emerald-600">
              {formatCurrency(
                toDisplay(totalEmployerMatch, avgPeriodsPerYear, period),
              )}
              <span className="text-muted ml-1 text-sm font-normal">{pl}</span>
            </div>
            <span className="text-muted text-sm">
              {formatCurrency(totalEmployerMatch)} annual employer match across
              all accounts
            </span>
          </div>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-muted border-b text-xs">
                <th className="py-1 text-left font-normal">Account</th>
                <th className="py-1 text-right font-normal">Employee</th>
                <th className="py-1 text-right font-normal">Match</th>
                <th className="py-1 text-right font-normal">Total</th>
              </tr>
            </thead>
            <tbody>
              {activePeople.flatMap((person) =>
                person.accountTypes
                  .filter((a) => a.employerMatch > 0)
                  .map((a) => (
                    <tr
                      key={`${person.person.id}-${a.accountType}`}
                      className="border-subtle border-b"
                    >
                      <td className="py-1.5">
                        <span className="flex items-center gap-2">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{
                              backgroundColor: categoryChartHex(
                                a.categoryKey,
                                false,
                              ),
                            }}
                          />
                          {a.accountType}
                          {activePeople.length > 1 && (
                            <span className="text-muted text-xs">
                              ({person.person.name})
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="py-1.5 text-right">
                        {formatCurrency(
                          toDisplay(
                            a.views[viewMode].employeeContrib,
                            person.periodsPerYear,
                            period,
                          ),
                        )}
                      </td>
                      <td className="py-1.5 text-right text-emerald-600">
                        {formatCurrency(
                          toDisplay(
                            a.views[viewMode].employerMatch,
                            person.periodsPerYear,
                            period,
                          ),
                        )}
                      </td>
                      <td className="py-1.5 text-right font-medium">
                        {formatCurrency(
                          toDisplay(
                            a.views[viewMode].totalContrib,
                            person.periodsPerYear,
                            period,
                          ),
                        )}
                      </td>
                    </tr>
                  )),
              )}
              {jointAccountTypes
                .filter((a) => a.employerMatch > 0)
                .map((a) => (
                  <tr
                    key={`joint-${a.accountType}`}
                    className="border-subtle border-b"
                  >
                    <td className="py-1.5">
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor: categoryChartHex(
                              a.categoryKey,
                              false,
                            ),
                          }}
                        />
                        {a.accountType}
                        <span className="text-muted text-xs">(Joint)</span>
                      </span>
                    </td>
                    <td className="py-1.5 text-right">
                      {formatCurrency(
                        toDisplay(
                          a.views[viewMode].employeeContrib,
                          avgPeriodsPerYear,
                          period,
                        ),
                      )}
                    </td>
                    <td className="py-1.5 text-right text-emerald-600">
                      {formatCurrency(
                        toDisplay(
                          a.views[viewMode].employerMatch,
                          avgPeriodsPerYear,
                          period,
                        ),
                      )}
                    </td>
                    <td className="py-1.5 text-right font-medium">
                      {formatCurrency(
                        toDisplay(
                          a.views[viewMode].totalContrib,
                          avgPeriodsPerYear,
                          period,
                        ),
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Per-person breakdown */}
      {activePeople.map((person) => (
        <Card
          key={person.person.id}
          title={
            activePeople.length > 1
              ? `${person.person.name} — ${formatCurrency(person.salary)}/yr`
              : `Breakdown — ${formatCurrency(person.salary)}/yr`
          }
          className="mb-6"
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted border-b text-xs">
                <th className="py-1 text-left font-normal">Account</th>
                <th className="py-1 text-right font-normal">Employee</th>
                <th className="py-1 text-right font-normal">Match</th>
                <th className="py-1 text-right font-normal">Limit</th>
                <th className="w-48 py-1 pl-4 text-left font-normal">
                  Utilization
                </th>
              </tr>
            </thead>
            <tbody>
              {person.accountTypes.map((a) => {
                const utilPct = a.views[viewMode].fundingPct * 100;
                const barColor =
                  utilPct >= 95
                    ? "bg-emerald-500"
                    : utilPct >= 80
                      ? "bg-yellow-500"
                      : "bg-blue-500";

                return (
                  <React.Fragment key={a.accountType}>
                    <tr className="border-subtle border-b">
                      <td className="py-2">
                        <span className="flex items-center gap-2">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{
                              backgroundColor: categoryChartHex(
                                a.categoryKey,
                                false,
                              ),
                            }}
                          />
                          <span>{a.accountType}</span>
                          {a.tradContrib > 0 && a.taxFreeContrib > 0 && (
                            <span className="text-muted text-xs">
                              T:
                              {formatPercent(
                                a.tradContrib /
                                  (a.tradContrib + a.taxFreeContrib),
                                0,
                              )}
                              /R:
                              {formatPercent(
                                a.taxFreeContrib /
                                  (a.tradContrib + a.taxFreeContrib),
                                0,
                              )}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="py-2 text-right">
                        {formatCurrency(
                          toDisplay(
                            a.views[viewMode].employeeContrib,
                            person.periodsPerYear,
                            period,
                          ),
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {a.employerMatch > 0 ? (
                          <span className="text-emerald-600">
                            {formatCurrency(
                              toDisplay(
                                a.views[viewMode].employerMatch,
                                person.periodsPerYear,
                                period,
                              ),
                            )}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="text-muted py-2 text-right">
                        {a.limit > 0 ? formatCurrency(a.limit) : "—"}
                      </td>
                      <td className="py-2 pl-4">
                        {a.limit > 0 ? (
                          <div className="flex items-center gap-2">
                            <div className="bg-surface-elevated h-2 flex-1 overflow-hidden rounded-full">
                              <div
                                className={`h-full rounded-full ${barColor}`}
                                style={{
                                  width: `${Math.min(100, utilPct)}%`,
                                }}
                              />
                            </div>
                            <span className="text-muted w-10 text-right text-xs">
                              {formatPercent(a.views[viewMode].fundingPct, 0)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted text-xs">No limit</span>
                        )}
                      </td>
                    </tr>
                    {a.priorYear && (
                      <tr className="border-subtle bg-surface-elevated border-b">
                        <td className="text-secondary py-1.5 pl-6 text-xs">
                          Prior year ({priorYearWindow?.priorYear})
                        </td>
                        <td className="py-1.5 text-right">
                          {canEdit && a.priorYear.contribs.length === 1 ? (
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              max={a.priorYear.limit}
                              defaultValue={a.priorYear.amount || ""}
                              placeholder="0"
                              className="bg-surface-primary text-primary border-subtle w-24 rounded border px-1.5 py-0.5 text-right text-xs"
                              onBlur={(e) => {
                                const val = e.target.value || "0";
                                if (Number(val) !== a.priorYear!.amount) {
                                  const contribId =
                                    a.priorYear!.contribs[0]?.id;
                                  if (contribId != null) {
                                    setPriorYear.mutate({
                                      id: contribId,
                                      priorYearContribAmount: val,
                                    });
                                  }
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter")
                                  (e.target as HTMLInputElement).blur();
                              }}
                            />
                          ) : canEdit && a.priorYear.contribs.length > 1 ? (
                            <span className="text-muted text-xs">
                              {formatCurrency(a.priorYear.amount)} (split)
                            </span>
                          ) : (
                            <span className="text-muted text-xs">
                              {formatCurrency(a.priorYear.amount)}
                            </span>
                          )}
                        </td>
                        <td className="text-muted py-1.5 text-right text-xs">
                          {formatCurrency(a.priorYear.remaining)} left
                        </td>
                        <td className="text-muted py-1.5 text-right text-xs">
                          {formatCurrency(a.priorYear.limit)}
                        </td>
                        <td className="py-1.5 pl-4">
                          <div className="flex items-center gap-2">
                            <div className="bg-surface-sunken h-1.5 flex-1 overflow-hidden rounded-full">
                              <div
                                className="h-full rounded-full bg-blue-500"
                                style={{
                                  width: `${Math.min(100, safeDivide(a.priorYear.amount, a.priorYear.limit, 0) * 100)}%`,
                                }}
                              />
                            </div>
                            <span className="text-caption text-muted w-10 text-right">
                              {(() => {
                                const priorYearRatio = safeDivide(
                                  a.priorYear.amount,
                                  a.priorYear.limit,
                                  null,
                                );
                                return priorYearRatio === null
                                  ? "—"
                                  : formatPercent(priorYearRatio, 0);
                              })()}
                            </span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2">
                <td className="py-2 font-medium">Total</td>
                <td className="py-2 text-right font-medium">
                  {formatCurrency(
                    toDisplay(
                      person.totals.views[viewMode].totalWithoutMatch,
                      person.periodsPerYear,
                      period,
                    ),
                  )}
                </td>
                <td className="py-2 text-right font-medium text-emerald-600">
                  {formatCurrency(
                    toDisplay(
                      person.totals.views[viewMode].totalWithMatch -
                        person.totals.views[viewMode].totalWithoutMatch,
                      person.periodsPerYear,
                      period,
                    ),
                  )}
                </td>
                <td colSpan={2} className="text-muted py-2 text-right text-sm">
                  {combinedSalary > 0 && (
                    <>
                      Savings rate:{" "}
                      {formatSavingsRate(
                        householdSavings([person], [], viewMode, {
                          excludeMatch,
                          includePortfolio,
                        }).rate,
                      )}{" "}
                      ({excludeMatch ? "w/o match" : "w/ match"})
                    </>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </Card>
      ))}

      {/* Joint accounts */}
      {jointAccountTypes.length > 0 && (
        <Card
          title={`Joint — ${formatCurrency(toDisplay(jointTotals.totalWithMatch, avgPeriodsPerYear, period))}${pl}`}
          className="mb-6"
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted border-b text-xs">
                <th className="py-1 text-left font-normal">Account</th>
                <th className="py-1 text-right font-normal">Employee</th>
                <th className="py-1 text-right font-normal">Match</th>
                <th className="py-1 text-right font-normal">Limit</th>
                <th className="w-48 py-1 pl-4 text-left font-normal">
                  Utilization
                </th>
              </tr>
            </thead>
            <tbody>
              {jointAccountTypes.map((a) => (
                <tr key={a.accountType} className="border-subtle border-b">
                  <td className="py-2">
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor: categoryChartHex(
                            a.categoryKey,
                            false,
                          ),
                        }}
                      />
                      <span>{a.accountType}</span>
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    {formatCurrency(
                      toDisplay(
                        a.views[viewMode].employeeContrib,
                        avgPeriodsPerYear,
                        period,
                      ),
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {a.employerMatch > 0 ? (
                      <span className="text-emerald-600">
                        {formatCurrency(
                          toDisplay(
                            a.views[viewMode].employerMatch,
                            avgPeriodsPerYear,
                            period,
                          ),
                        )}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="text-muted py-2 text-right">—</td>
                  <td className="py-2 pl-4">
                    <span className="text-muted text-xs">No limit</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2">
                <td className="py-2 font-medium">Total</td>
                <td className="py-2 text-right font-medium">
                  {formatCurrency(
                    toDisplay(
                      jointTotals.totalWithoutMatch,
                      avgPeriodsPerYear,
                      period,
                    ),
                  )}
                </td>
                <td className="py-2 text-right font-medium text-emerald-600">
                  {formatCurrency(
                    toDisplay(
                      jointTotals.totalWithMatch -
                        jointTotals.totalWithoutMatch,
                      avgPeriodsPerYear,
                      period,
                    ),
                  )}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </Card>
      )}

      {/* Profile comparison */}
      {selectedProfileId && profileData && (
        <Card title="Profile Comparison" className="mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted border-b text-xs">
                <th className="py-1 text-left font-normal">Metric</th>
                <th className="py-1 text-right font-normal">Current</th>
                <th className="py-1 text-right font-normal">Profile</th>
                <th className="py-1 text-right font-normal">Delta</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const profile = savingsOf(
                  {
                    people: profileData.people.filter((p) => p.salary > 0),
                    joint: profileData.jointAccountTypes ?? [],
                  },
                  excludeMatch,
                );
                return [
                  {
                    label: excludeMatch
                      ? "Total (w/o match)"
                      : "Total (w/ match)",
                    current: excludeMatch ? totalWithout : totalWith,
                    profile: profile.total,
                  },
                  {
                    label: "Retirement",
                    current: excludeMatch
                      ? totalRetirementWithout
                      : totalRetirementWith,
                    profile: group(profile, "retirement").total,
                  },
                  {
                    label: "Portfolio",
                    current: excludeMatch
                      ? totalPortfolioWithout
                      : totalPortfolioWith,
                    profile: group(profile, "portfolio").total,
                  },
                ];
              })().map((row) => {
                const delta = row.profile - row.current;
                return (
                  <tr key={row.label} className="border-subtle border-b">
                    <td className="py-1.5">{row.label}</td>
                    <td className="py-1.5 text-right">
                      {formatCurrency(
                        toDisplay(row.current, avgPeriodsPerYear, period),
                      )}
                    </td>
                    <td className="py-1.5 text-right">
                      {formatCurrency(
                        toDisplay(row.profile, avgPeriodsPerYear, period),
                      )}
                    </td>
                    <td
                      className={`py-1.5 text-right font-medium ${gainLossTextColor(delta)}`}
                    >
                      {delta > 0 ? "+" : ""}
                      {formatCurrency(
                        toDisplay(delta, avgPeriodsPerYear, period),
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  rate,
  rateAlt,
  altLabel,
  amount,
  pl,
  color,
  note,
}: {
  label: string;
  rate: number;
  rateAlt: number;
  altLabel: string;
  amount: number;
  pl: string;
  color: string;
  note?: string;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-2 py-1">
        <span className="text-muted text-xs tracking-wide uppercase">
          {label}
        </span>
        <div className="text-3xl font-bold">{formatSavingsRate(rate)}</div>
        <div className="text-muted text-sm">
          {formatCurrency(amount)}
          {pl}
          {rate !== rateAlt && (
            <span className="ml-2 text-xs">
              ({formatSavingsRate(rateAlt)} {altLabel})
            </span>
          )}
        </div>
        <div className="bg-surface-elevated h-1.5 overflow-hidden rounded-full">
          <div
            className={`h-full rounded-full ${color}`}
            style={{ width: `${Math.min(100, rate * 100)}%` }}
          />
        </div>
        {note && <p className="text-faint text-xs">{note}</p>}
      </div>
    </Card>
  );
}
