"use client";

/**
 * Utilities ▸ costs from the budget: map each utility to the budget
 * category its bills are paid from (and how many months after the service
 * month they're paid), then pull — the preview lists the months it would
 * fill or refresh and the ones it leaves for review because someone else
 * wrote a different cost. Usage stays typed in.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { budgetApiServiceLabel, formatCurrency } from "@/lib/utils/format";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function UtilityFeedCard() {
  const admin = isAdmin(useUser());
  const utils = trpc.useUtils();
  const { data: services } = trpc.utilities.listServices.useQuery();
  const { data: cats } = trpc.utilities.listBudgetApiCategories.useQuery();
  const [reviewing, setReviewing] = useState(false);
  const { data: plan, isFetching } =
    trpc.utilities.previewBudgetApiFeed.useQuery(undefined, {
      enabled: reviewing,
    });
  const update = trpc.utilities.updateService.useMutation({
    onSuccess: () => utils.utilities.invalidate(),
  });
  const apply = trpc.utilities.applyBudgetApiFeed.useMutation({
    onSuccess: () => {
      utils.utilities.invalidate();
      setReviewing(false);
    },
  });

  if (!admin || !cats || cats.service === "none") return null;
  const label = budgetApiServiceLabel(cats.service);
  const name = (serviceId: number) => {
    const s = services?.find((x) => x.id === serviceId);
    return s ? capitalize(s.kind) : `#${serviceId}`;
  };
  const anyMapped = services?.some((s) => s.budgetApiCategoryId);

  return (
    <Card title={`Costs from ${label}`}>
      <p className="text-muted mb-3 text-xs">
        Pick the {label} category each utility&apos;s bills are paid from. Bills
        are usually paid the month after the service month — set how many months
        later. A month&apos;s cost is its bills less any refunds. Pulling fills
        months with no cost and refreshes ones it filled before; a cost you
        typed is never replaced. Usage stays yours to enter.
      </p>
      {cats.categories.length === 0 ? (
        <p className="text-faint text-xs">
          Sync {label} first — its categories show up here after a sync.
        </p>
      ) : (
        <div className="space-y-2">
          {services?.map((s) => (
            <div
              key={s.id}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <span className="w-24">{capitalize(s.kind)}</span>
              <select
                aria-label={`${s.kind} category`}
                value={s.budgetApiCategoryId ?? ""}
                onChange={(e) =>
                  update.mutate({
                    id: s.id,
                    budgetApiCategoryId: e.target.value || null,
                  })
                }
                className="border-strong rounded border px-2 py-1 text-sm"
              >
                <option value="">Not fed</option>
                {cats.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.groupName} · {c.name}
                  </option>
                ))}
              </select>
              <label className="text-muted text-xs">
                paid
                <input
                  type="number"
                  min={0}
                  max={6}
                  value={s.billingLagMonths}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!Number.isNaN(n) && n >= 0 && n <= 6)
                      update.mutate({ id: s.id, billingLagMonths: n });
                  }}
                  className="border-strong mx-1 w-12 rounded border px-1 py-0.5 text-sm"
                />
                month{s.billingLagMonths === 1 ? "" : "s"} later
              </label>
            </div>
          ))}
          <div className="pt-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!anyMapped}
              onClick={() => setReviewing(!reviewing)}
            >
              {reviewing ? "Close" : `Pull costs from ${label}`}
            </Button>
          </div>
        </div>
      )}

      {reviewing && (
        <div className="mt-3 border-t pt-3 text-sm">
          {isFetching || !plan ? (
            <p className="text-faint text-xs">Checking {label}…</p>
          ) : plan.changes.length === 0 &&
            plan.conflicts.length === 0 &&
            plan.gone.length === 0 ? (
            <p className="text-muted text-xs">
              Nothing to pull — every month matches {label}.
            </p>
          ) : (
            <>
              {plan.changes.length > 0 && (
                <table className="mb-2 w-full text-xs">
                  <thead>
                    <tr className="text-faint text-left">
                      <th className="py-1 font-medium">Month</th>
                      <th className="py-1 font-medium">Utility</th>
                      <th className="py-1 text-right font-medium">Now</th>
                      <th className="py-1 text-right font-medium">
                        From {label}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.changes.map((c) => (
                      <tr
                        key={`${c.serviceId}-${c.year}-${c.month}`}
                        className="border-subtle border-t"
                      >
                        <td className="py-1">
                          {MONTHS[c.month - 1]} {c.year}
                          {c.payments > 1 && (
                            <span
                              className="ml-1 text-amber-600"
                              title="More than one bill landed in this month — one may have been paid early or late"
                            >
                              ({c.payments} bills)
                            </span>
                          )}
                        </td>
                        <td className="py-1">{name(c.serviceId)}</td>
                        <td className="text-faint py-1 text-right tabular-nums">
                          {c.previous == null
                            ? "—"
                            : formatCurrency(c.previous)}
                        </td>
                        <td className="py-1 text-right font-medium tabular-nums">
                          {formatCurrency(c.cost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {plan.conflicts.length > 0 && (
                <div className="mb-2">
                  <p className="text-muted mb-1 text-xs">
                    Left as they are — a different cost was typed in (edit the
                    month to use {label}&apos;s):
                  </p>
                  <ul className="text-faint space-y-0.5 text-xs">
                    {plan.conflicts.map((c) => (
                      <li key={`${c.serviceId}-${c.year}-${c.month}`}>
                        {MONTHS[c.month - 1]} {c.year} · {name(c.serviceId)}:{" "}
                        {formatCurrency(c.previous)} recorded,{" "}
                        {formatCurrency(c.cost)} in {label}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {plan.credits.length > 0 && (
                <p className="text-faint mb-2 text-xs">
                  Not written — refunds outweigh bills:{" "}
                  {plan.credits
                    .map(
                      (c) =>
                        `${MONTHS[c.month - 1]} ${c.year} · ${name(c.serviceId)}`,
                    )
                    .join(", ")}
                  .
                </p>
              )}
              {plan.gone.length > 0 && (
                <p className="text-faint mb-2 text-xs">
                  Filled from {label} before but no longer in it (left as they
                  are):{" "}
                  {plan.gone
                    .map(
                      (g) =>
                        `${MONTHS[g.month - 1]} ${g.year} · ${name(g.serviceId)} ${formatCurrency(g.cost)}`,
                    )
                    .join(", ")}
                  .
                </p>
              )}
              {apply.isError && (
                <p className="mb-2 text-xs text-red-600">
                  {apply.error.message}
                </p>
              )}
              {plan.changes.length > 0 && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={apply.isPending}
                  onClick={() => apply.mutate({ planHash: plan.planHash })}
                >
                  {apply.isPending
                    ? "Writing…"
                    : `Write ${plan.changes.length} month${plan.changes.length === 1 ? "" : "s"}`}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
