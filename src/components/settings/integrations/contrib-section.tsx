"use client";

/**
 * Integrations preview section linking a Ledgr budget item to a non-payroll contribution account,
 * so push-sync knows where the monthly amount lands. Renders only when there is something to show.
 */
import type { PreviewData } from "../integrations-types";
import { useIntegrationContributionAccountMutations } from "./use-integration-contribution-account-mutations";
import { Badge } from "@/components/ui/badge";
import {
  SectionSummaryBadge,
  SectionSummaryRow,
} from "./section-summary-badge";

type ContributionAccount = {
  id: number;
  displayLabel: string;
};

type Props = {
  budget: NonNullable<PreviewData["budget"]>;
  contributionAccounts: ContributionAccount[];
};

export function ContributionSection({ budget, contributionAccounts }: Props) {
  const {
    linkContrib: linkContributionMut,
    unlinkContrib: unlinkContributionMut,
  } = useIntegrationContributionAccountMutations();

  if (contributionAccounts.length === 0) return null;

  const linkedItems = budget.matches.filter(
    (m) => m.contributionAccountId != null,
  );
  const usedContributionIds = new Set(
    linkedItems.map((m) => m.contributionAccountId),
  );
  const unlinkedContributions = contributionAccounts.filter(
    (ca) => !usedContributionIds.has(ca.id),
  );
  const unlinkedBudgetItems = budget.matches.filter(
    (m) => m.contributionAccountId == null,
  );

  if (linkedItems.length === 0 && unlinkedContributions.length === 0)
    return null;

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
            value={unlinkedContributions.length}
            label="unlinked"
            tone={unlinkedContributions.length > 0 ? "amber" : "faint"}
          />
        </SectionSummaryRow>
      </summary>
      <div className="space-y-2 px-3 pb-3">
        {/* Already linked items */}
        {linkedItems.length > 0 && (
          <div className="space-y-0.5">
            {linkedItems.map((m) => {
              const ca = contributionAccounts.find(
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
                      unlinkContributionMut.mutate({
                        budgetItemId: m.budgetItemId,
                      })
                    }
                    disabled={unlinkContributionMut.isPending}
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
        {unlinkedContributions.length > 0 && (
          <div className="border-subtle space-y-0.5 border-t pt-2">
            <p className="text-caption text-faint mb-1">
              {unlinkedContributions.length} unlinked contribution{" "}
              {unlinkedContributions.length === 1 ? "account" : "accounts"}
            </p>
            {unlinkedContributions.map((ca) => (
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
                  aria-label={`Budget item for ${ca.displayLabel}`}
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      linkContributionMut.mutate({
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
