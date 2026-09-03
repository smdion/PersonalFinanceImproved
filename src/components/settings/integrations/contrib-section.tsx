"use client";

/**
 * Non-payroll contribution-account-linking section of the integrations
 * preview panel. Lets the user tie a Ledgr budget item (e.g. "401k
 * contribution") to a contribution account so the push-sync flow knows
 * which account the monthly amount should land in.
 *
 * Section is only rendered when there is at least one contribution
 * account and at least one linked or unlinked item to show.
 */
import type { PreviewData } from "../integrations-types";
import type { ContribMutations } from "./hooks/use-contrib-mutations";
import { Badge } from "@/components/ui/badge";
import {
  SectionSummaryBadge,
  SectionSummaryRow,
} from "./section-summary-badge";

type ContribAccount = {
  id: number;
  displayLabel: string;
};

type Props = {
  budget: NonNullable<PreviewData["budget"]>;
  contribAccounts: ContribAccount[];
  mutations: ContribMutations;
};

export function ContribSection({ budget, contribAccounts, mutations }: Props) {
  const { linkContrib: linkContribMut, unlinkContrib: unlinkContribMut } =
    mutations;

  if (contribAccounts.length === 0) return null;

  const linkedItems = budget.matches.filter(
    (m) => m.contributionAccountId != null,
  );
  const usedContribIds = new Set(
    linkedItems.map((m) => m.contributionAccountId),
  );
  const unlinkedContribs = contribAccounts.filter(
    (ca) => !usedContribIds.has(ca.id),
  );
  const unlinkedBudgetItems = budget.matches.filter(
    (m) => m.contributionAccountId == null,
  );

  if (linkedItems.length === 0 && unlinkedContribs.length === 0) return null;

  return (
    <details className="border-subtle rounded-lg border">
      <summary className="flex cursor-pointer items-center justify-between px-3 py-2.5 select-none">
        <span className="text-muted text-xs font-medium">
          Contribution Account Linking
        </span>
        <SectionSummaryRow>
          <SectionSummaryBadge
            value={linkedItems.length}
            label="linked"
            tone="green"
          />
          <SectionSummaryBadge
            value={unlinkedContribs.length}
            label="unlinked"
            tone={unlinkedContribs.length > 0 ? "amber" : "faint"}
          />
        </SectionSummaryRow>
      </summary>
      <div className="space-y-2 px-3 pb-3">
        {/* Already linked items */}
        {linkedItems.length > 0 && (
          <div className="space-y-0.5">
            {linkedItems.map((m) => {
              const ca = contribAccounts.find(
                (c) => c.id === m.contributionAccountId,
              );
              return (
                <div
                  key={m.budgetItemId}
                  className="flex min-h-[24px] items-center gap-1.5 text-xs"
                >
                  <Badge
                    color="green"
                    size="sm"
                    case="normal"
                    className="whitespace-nowrap"
                  >
                    Linked
                  </Badge>
                  <span
                    className="text-secondary max-w-[140px] min-w-[80px] truncate"
                    title={`${m.ledgrCategory} > ${m.ledgrName}`}
                  >
                    {m.ledgrName}
                  </span>
                  <span className="text-faint">&rarr;</span>
                  <span
                    className="flex-1 truncate text-green-700"
                    title={
                      ca?.displayLabel ?? `Account #${m.contributionAccountId}`
                    }
                  >
                    {ca?.displayLabel ?? `Account #${m.contributionAccountId}`}
                  </span>
                  <button
                    onClick={() =>
                      unlinkContribMut.mutate({
                        budgetItemId: m.budgetItemId,
                      })
                    }
                    disabled={unlinkContribMut.isPending}
                    className="text-caption whitespace-nowrap text-red-400 hover:text-red-600"
                    title="Unlink contribution account"
                  >
                    &times;
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Unlinked contribution accounts — pick a budget item to link */}
        {unlinkedContribs.length > 0 && (
          <div className="border-subtle space-y-0.5 border-t pt-2">
            <p className="text-caption text-faint mb-1">
              {unlinkedContribs.length} unlinked contribution{" "}
              {unlinkedContribs.length === 1 ? "account" : "accounts"}
            </p>
            {unlinkedContribs.map((ca) => (
              <div
                key={ca.id}
                className="flex min-h-[24px] items-center gap-1.5 text-xs"
              >
                <span className="text-caption bg-surface-elevated text-faint rounded px-1.5 py-0.5 whitespace-nowrap">
                  Unlinked
                </span>
                <span
                  className="text-secondary max-w-[220px] min-w-[80px] truncate"
                  title={ca.displayLabel}
                >
                  {ca.displayLabel}
                </span>
                <span className="text-faint">&rarr;</span>
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      linkContribMut.mutate({
                        budgetItemId: Number(e.target.value),
                        contributionAccountId: ca.id,
                      });
                    }
                  }}
                  className="text-label border-strong bg-surface-primary flex-1 rounded border px-1 py-0.5"
                >
                  <option value="">Select budget item...</option>
                  {unlinkedBudgetItems.map((m) => (
                    <option key={m.budgetItemId} value={m.budgetItemId}>
                      {m.ledgrCategory} &rsaquo; {m.ledgrName}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
