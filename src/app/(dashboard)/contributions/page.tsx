"use client";

/** Manages retirement and savings contribution allocations across accounts, with IRS limit tracking and profile switching. */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useActiveContribProfile } from "@/lib/hooks/use-active-contrib-profile";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { accountColor } from "@/lib/utils/colors";

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

export default function ContributionsPage() {
  const { data, isLoading } = trpc.contribution.computeSummary.useQuery();
  const { data: profiles } = trpc.contributionProfile.list.useQuery();
  const [period, setPeriod] = useState<PeriodMode>("annual");
  const [activeProfileId] = useActiveContribProfile();
  const [selectedProfileId, setSelectedProfileId] = useState<
    number | undefined
  >(activeProfileId ?? undefined);

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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const people = data?.people ?? [];

  if (!data || people.length === 0) {
    return (
      <div>
        <PageHeader
          title="Contributions"
          subtitle="Household contribution breakdown and savings rates"
        />
        <Card>
          <p className="text-muted text-sm py-8 text-center">
            No contribution accounts configured. Add contribution accounts on
            the Paycheck page.
          </p>
        </Card>
      </div>
    );
  }

  const activePeople = people.filter((p) => p.salary > 0);
  const combinedSalary = activePeople.reduce((s, p) => s + p.salary, 0);
  const avgPeriodsPerYear =
    activePeople.length > 0
      ? activePeople.reduce((s, p) => s + p.periodsPerYear, 0) /
        activePeople.length
      : 26;

  // Household totals
  const totalRetirementWith = activePeople.reduce(
    (s, p) => s + p.totals.retirementWithMatch,
    0,
  );
  const totalRetirementWithout = activePeople.reduce(
    (s, p) => s + p.totals.retirementWithoutMatch,
    0,
  );
  const totalPortfolioWith = activePeople.reduce(
    (s, p) => s + p.totals.portfolioWithMatch,
    0,
  );
  const totalPortfolioWithout = activePeople.reduce(
    (s, p) => s + p.totals.portfolioWithoutMatch,
    0,
  );
  const totalWith = activePeople.reduce(
    (s, p) => s + p.totals.totalWithMatch,
    0,
  );
  const totalWithout = activePeople.reduce(
    (s, p) => s + p.totals.totalWithoutMatch,
    0,
  );
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
            <select
              value={selectedProfileId ?? ""}
              onChange={(e) =>
                setSelectedProfileId(
                  e.target.value ? parseInt(e.target.value) : undefined,
                )
              }
              className="px-2 py-1 text-sm border rounded bg-surface-primary text-primary"
            >
              <option value="">Current</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <div className="flex gap-1 bg-surface-elevated rounded-full p-0.5">
            {(["annual", "monthly", "per-period"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setPeriod(m)}
                className={`px-3 py-1 text-xs rounded-full transition-colors ${
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

      {/* Household summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <SummaryCard
          label="Total Savings"
          rate={combinedSalary > 0 ? totalWith / combinedSalary : 0}
          rateWithout={combinedSalary > 0 ? totalWithout / combinedSalary : 0}
          amount={toDisplay(totalWith, avgPeriodsPerYear, period)}
          pl={pl}
          color="bg-blue-500"
        />
        <SummaryCard
          label="Retirement"
          rate={combinedSalary > 0 ? totalRetirementWith / combinedSalary : 0}
          rateWithout={
            combinedSalary > 0 ? totalRetirementWithout / combinedSalary : 0
          }
          amount={toDisplay(totalRetirementWith, avgPeriodsPerYear, period)}
          pl={pl}
          color="bg-emerald-500"
        />
        <SummaryCard
          label="Portfolio"
          rate={combinedSalary > 0 ? totalPortfolioWith / combinedSalary : 0}
          rateWithout={
            combinedSalary > 0 ? totalPortfolioWithout / combinedSalary : 0
          }
          amount={toDisplay(totalPortfolioWith, avgPeriodsPerYear, period)}
          pl={pl}
          color="bg-purple-500"
        />
      </div>

      {/* Employer match summary */}
      {totalEmployerMatch > 0 && (
        <Card title="Employer Match" className="mb-6">
          <div className="flex items-center gap-4 py-2">
            <div className="text-2xl font-bold text-emerald-600">
              {formatCurrency(
                toDisplay(totalEmployerMatch, avgPeriodsPerYear, period),
              )}
              <span className="text-sm font-normal text-muted ml-1">{pl}</span>
            </div>
            <span className="text-sm text-muted">
              {formatCurrency(totalEmployerMatch)} annual employer match across
              all accounts
            </span>
          </div>
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="text-xs text-muted border-b">
                <th className="text-left py-1 font-normal">Account</th>
                <th className="text-right py-1 font-normal">Employee</th>
                <th className="text-right py-1 font-normal">Match</th>
                <th className="text-right py-1 font-normal">Total</th>
              </tr>
            </thead>
            <tbody>
              {activePeople.flatMap((person) =>
                person.accountTypes
                  .filter((a) => a.employerMatch > 0)
                  .map((a) => (
                    <tr
                      key={`${person.person.id}-${a.accountType}`}
                      className="border-b border-subtle"
                    >
                      <td className="py-1.5">
                        <span className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{
                              backgroundColor: accountColor(a.colorKey),
                            }}
                          />
                          {a.accountType}
                          {activePeople.length > 1 && (
                            <span className="text-xs text-muted">
                              ({person.person.name})
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="text-right py-1.5">
                        {formatCurrency(
                          toDisplay(
                            a.employeeContrib,
                            person.periodsPerYear,
                            period,
                          ),
                        )}
                      </td>
                      <td className="text-right py-1.5 text-emerald-600">
                        {formatCurrency(
                          toDisplay(
                            a.employerMatch,
                            person.periodsPerYear,
                            period,
                          ),
                        )}
                      </td>
                      <td className="text-right py-1.5 font-medium">
                        {formatCurrency(
                          toDisplay(
                            a.totalContrib,
                            person.periodsPerYear,
                            period,
                          ),
                        )}
                      </td>
                    </tr>
                  )),
              )}
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
              <tr className="text-xs text-muted border-b">
                <th className="text-left py-1 font-normal">Account</th>
                <th className="text-right py-1 font-normal">Employee</th>
                <th className="text-right py-1 font-normal">Match</th>
                <th className="text-right py-1 font-normal">Limit</th>
                <th className="text-left py-1 font-normal pl-4 w-48">
                  Utilization
                </th>
              </tr>
            </thead>
            <tbody>
              {person.accountTypes.map((a) => {
                const utilPct = a.fundingPct * 100;
                const barColor =
                  utilPct >= 95
                    ? "bg-emerald-500"
                    : utilPct >= 80
                      ? "bg-yellow-500"
                      : "bg-blue-500";

                return (
                  <tr key={a.accountType} className="border-b border-subtle">
                    <td className="py-2">
                      <span className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{
                            backgroundColor: accountColor(a.colorKey),
                          }}
                        />
                        <span>{a.accountType}</span>
                        {a.tradContrib > 0 && a.taxFreeContrib > 0 && (
                          <span className="text-xs text-muted">
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
                    <td className="text-right py-2">
                      {formatCurrency(
                        toDisplay(
                          a.employeeContrib,
                          person.periodsPerYear,
                          period,
                        ),
                      )}
                    </td>
                    <td className="text-right py-2">
                      {a.employerMatch > 0 ? (
                        <span className="text-emerald-600">
                          {formatCurrency(
                            toDisplay(
                              a.employerMatch,
                              person.periodsPerYear,
                              period,
                            ),
                          )}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="text-right py-2 text-muted">
                      {a.limit > 0 ? formatCurrency(a.limit) : "—"}
                    </td>
                    <td className="py-2 pl-4">
                      {a.limit > 0 ? (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-surface-elevated rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${barColor}`}
                              style={{
                                width: `${Math.min(100, utilPct)}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs text-muted w-10 text-right">
                            {formatPercent(a.fundingPct, 0)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted">No limit</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2">
                <td className="py-2 font-medium">Total</td>
                <td className="text-right py-2 font-medium">
                  {formatCurrency(
                    toDisplay(
                      person.totals.totalWithoutMatch,
                      person.periodsPerYear,
                      period,
                    ),
                  )}
                </td>
                <td className="text-right py-2 font-medium text-emerald-600">
                  {formatCurrency(
                    toDisplay(
                      person.totals.totalWithMatch -
                        person.totals.totalWithoutMatch,
                      person.periodsPerYear,
                      period,
                    ),
                  )}
                </td>
                <td colSpan={2} className="text-right py-2 text-sm text-muted">
                  {combinedSalary > 0 && (
                    <>
                      Savings rate:{" "}
                      {formatPercent(
                        person.totals.totalWithMatch / person.salary,
                        1,
                      )}{" "}
                      (with match)
                    </>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </Card>
      ))}

      {/* Profile comparison */}
      {selectedProfileId && profileData && (
        <Card title="Profile Comparison" className="mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted border-b">
                <th className="text-left py-1 font-normal">Metric</th>
                <th className="text-right py-1 font-normal">Current</th>
                <th className="text-right py-1 font-normal">Profile</th>
                <th className="text-right py-1 font-normal">Delta</th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  label: "Total (with match)",
                  current: totalWith,
                  profile: profileData.people.reduce(
                    (s, p) => s + p.totals.totalWithMatch,
                    0,
                  ),
                },
                {
                  label: "Retirement",
                  current: totalRetirementWith,
                  profile: profileData.people.reduce(
                    (s, p) => s + p.totals.retirementWithMatch,
                    0,
                  ),
                },
                {
                  label: "Portfolio",
                  current: totalPortfolioWith,
                  profile: profileData.people.reduce(
                    (s, p) => s + p.totals.portfolioWithMatch,
                    0,
                  ),
                },
              ].map((row) => {
                const delta = row.profile - row.current;
                return (
                  <tr key={row.label} className="border-b border-subtle">
                    <td className="py-1.5">{row.label}</td>
                    <td className="text-right py-1.5">
                      {formatCurrency(
                        toDisplay(row.current, avgPeriodsPerYear, period),
                      )}
                    </td>
                    <td className="text-right py-1.5">
                      {formatCurrency(
                        toDisplay(row.profile, avgPeriodsPerYear, period),
                      )}
                    </td>
                    <td
                      className={`text-right py-1.5 font-medium ${
                        delta > 0
                          ? "text-emerald-600"
                          : delta < 0
                            ? "text-red-500"
                            : "text-muted"
                      }`}
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
  rateWithout,
  amount,
  pl,
  color,
}: {
  label: string;
  rate: number;
  rateWithout: number;
  amount: number;
  pl: string;
  color: string;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-2 py-1">
        <span className="text-xs text-muted uppercase tracking-wide">
          {label}
        </span>
        <div className="text-3xl font-bold">{formatPercent(rate, 1)}</div>
        <div className="text-sm text-muted">
          {formatCurrency(amount)}
          {pl}
          {rate !== rateWithout && (
            <span className="ml-2 text-xs">
              ({formatPercent(rateWithout, 1)} w/o match)
            </span>
          )}
        </div>
        <div className="h-1.5 bg-surface-elevated rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${color}`}
            style={{ width: `${Math.min(100, rate * 100)}%` }}
          />
        </div>
      </div>
    </Card>
  );
}
