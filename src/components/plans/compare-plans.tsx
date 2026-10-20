"use client";

/**
 * Compare Plans — each saved Plan's key numbers side by side. No new math:
 * every figure comes from the same procedures the Budget and Retirement
 * pages use, run with that Plan's profiles (a Plan slot left empty uses the
 * active profile of that kind, as applying it would).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { FieldRow } from "@/components/ui/field-row";
import { HelpTip } from "@/components/ui/help-tip";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils/format";
import { usePlans } from "@/lib/hooks/use-plans";
import {
  PLAN_PROFILE_KINDS,
  PLAN_PROFILE_KIND_TITLES,
  planProfileIds,
  type PlanProfileIds,
  type PlanProfileKind,
} from "@/lib/config/plans";
import { useBudgetProfilesList } from "@/lib/hooks/use-budget-profiles-list";
import { confirm } from "@/components/ui/confirm-dialog";

const MAX_COMPARED = 3;

/** One Plan's column. */
function PlanColumn({
  name,
  ids,
  inUse,
  profileName,
  onApply,
  applying,
}: {
  name: string;
  ids: PlanProfileIds;
  inUse: boolean;
  profileName: (kind: PlanProfileKind, id: number | null) => string;
  onApply?: () => void;
  applying: boolean;
}) {
  const tiers = (id: number | null) => ({
    localSelectionId: id,
    globalDefaultId: id,
  });
  const budget = trpc.budget.computeActiveSummary.useQuery(
    {
      selectedColumn: 0,
      ...(ids.budget != null ? { profileId: ids.budget } : {}),
      contributionProfile: tiers(ids.contribution),
      salaryProfile: tiers(ids.salary),
    },
    { enabled: ids.budget != null },
  );
  const projection = trpc.projection.computeProjection.useQuery({
    accumulationOverrides: [],
    decumulationOverrides: [],
    ...(ids.contribution != null
      ? { contributionProfileId: ids.contribution }
      : {}),
    ...(ids.salary != null ? { salaryProfileId: ids.salary } : {}),
    ...(ids.retirement != null ? { retirementProfileId: ids.retirement } : {}),
    ...(ids.budget != null ? { accumulationBudgetProfileId: ids.budget } : {}),
  });

  // The union's "no profile" branch carries neither figure.
  const summary =
    budget.data && "netMonthlyIncome" in budget.data ? budget.data : null;
  const takeHome =
    summary?.netMonthlyIncome != null ? summary.netMonthlyIncome * 12 : null;
  const spending = summary?.weightedAnnualTotal ?? null;
  const result = projection.data?.result ?? null;
  const money = (v: number | null) =>
    v == null ? (budget.isLoading ? "…" : "—") : formatCurrency(v, 0);

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {name}
          {inUse && <Badge color="blue">In use</Badge>}
        </span>
      }
    >
      <div className="space-y-1.5 text-sm">
        {PLAN_PROFILE_KINDS.map((k) => (
          <FieldRow
            key={k}
            label={
              <span className="text-muted">{PLAN_PROFILE_KIND_TITLES[k]}</span>
            }
          >
            <span>{profileName(k, ids[k])}</span>
          </FieldRow>
        ))}
        <div className="border-subtle my-2 border-t" />
        <FieldRow label="Take-home pay / yr">
          <span className="font-medium">{money(takeHome)}</span>
        </FieldRow>
        <FieldRow label="Budget spending / yr">
          <span>{money(spending)}</span>
        </FieldRow>
        <FieldRow
          label={
            <>
              Left after the budget / yr
              <HelpTip text="Take-home pay minus budget spending — what savings goals can use." />
            </>
          }
        >
          <span className="font-medium">
            {money(
              takeHome != null && spending != null ? takeHome - spending : null,
            )}
          </span>
        </FieldRow>
        <div className="border-subtle my-2 border-t" />
        <FieldRow
          label={
            <>
              Sustainable withdrawal
              <HelpTip text="At retirement: the portfolio × your withdrawal rate (a reference figure, from the Retirement projection)." />
            </>
          }
        >
          <span>
            {result
              ? formatCurrency(result.sustainableWithdrawal, 0)
              : projection.isLoading
                ? "…"
                : "—"}
          </span>
        </FieldRow>
        <FieldRow label="Money lasts">
          <span>
            {result
              ? result.portfolioDepletionAge != null
                ? `to age ${Math.round(result.portfolioDepletionAge)}`
                : "through the plan"
              : projection.isLoading
                ? "…"
                : "—"}
          </span>
        </FieldRow>
        {onApply && !inUse && (
          <div className="pt-2 text-right">
            <button
              type="button"
              onClick={onApply}
              disabled={applying}
              className="text-caption rounded border px-2.5 py-1 text-blue-600 hover:bg-blue-50 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
            >
              Apply this Plan
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}

export function ComparePlans() {
  const { plans, activeIds, planInUse, apply } = usePlans();
  const { data: budgetProfiles } = useBudgetProfilesList();
  const { data: contribProfiles } = trpc.contributionProfile.list.useQuery();
  const { data: salaryProfiles } = trpc.salaryProfile.list.useQuery();
  const { data: retirementProfiles } =
    trpc.retirement.retirementProfiles.list.useQuery();
  const lists: Record<
    PlanProfileKind,
    readonly { id: number; name: string }[] | undefined
  > = {
    salary: salaryProfiles,
    contribution: contribProfiles,
    budget: budgetProfiles,
    retirement: retirementProfiles,
  };
  const profileName = (kind: PlanProfileKind, id: number | null) =>
    lists[kind]?.find((p) => p.id === id)?.name ?? "—";

  const [picked, setPicked] = useState<number[] | null>(null);
  const selected = picked ?? plans.slice(0, MAX_COMPARED).map((p) => p.id);

  if (plans.length === 0)
    return (
      <p className="text-muted text-sm">
        No Plans yet. Pick a profile of each kind in the header, then use the
        Plan menu&apos;s &ldquo;Save these profiles as a new Plan&rdquo;.
      </p>
    );

  const toggle = (id: number) =>
    setPicked(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id].slice(-MAX_COMPARED),
    );

  return (
    <div className="space-y-4">
      <p className="text-muted text-sm">
        Each Plan&apos;s numbers, worked out with its own profiles. Pick up to{" "}
        {MAX_COMPARED}.
      </p>
      <div className="flex flex-wrap gap-3">
        {plans.map((p) => (
          <label key={p.id} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(p.id)}
              onChange={() => toggle(p.id)}
            />
            {p.name}
          </label>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans
          .filter((p) => selected.includes(p.id))
          .map((p) => {
            const own = planProfileIds(p);
            const ids = Object.fromEntries(
              PLAN_PROFILE_KINDS.map((k) => [k, own[k] ?? activeIds[k]]),
            ) as PlanProfileIds;
            return (
              <PlanColumn
                key={p.id}
                name={p.name}
                ids={ids}
                inUse={p.id === planInUse?.id}
                profileName={profileName}
                onApply={async () => {
                  if (
                    await confirm(
                      `Apply Plan "${p.name}"? Its profiles become the active ones for everyone in the household (and what syncs to your budget app).`,
                    )
                  )
                    apply.mutate({ id: p.id });
                }}
                applying={apply.isPending}
              />
            );
          })}
      </div>
    </div>
  );
}
