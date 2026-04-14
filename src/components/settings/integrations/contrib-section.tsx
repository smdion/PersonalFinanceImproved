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
    <details className="border border-subtle rounded-lg">
      <summary className="px-3 py-2.5 cursor-pointer select-none flex items-center justify-between">
        <span className="text-xs font-medium text-muted">
          Contribution Account Linking
        </span>
        <span className="text-[10px] text-faint">
          {linkedItems.length} linked · {unlinkedContribs.length} unlinked
        </span>
      </summary>
      <div className="px-3 pb-3 space-y-2">
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
                  className="flex items-center gap-1.5 text-xs min-h-[24px]"
                >
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700 whitespace-nowrap">
                    Linked
                  </span>
                  <span
                    className="text-secondary truncate min-w-[80px] max-w-[140px]"
                    title={`${m.ledgrCategory} > ${m.ledgrName}`}
                  >
                    {m.ledgrName}
                  </span>
                  <span className="text-faint">&rarr;</span>
                  <span className="text-green-700 truncate flex-1">
                    {ca?.displayLabel ?? `Account #${m.contributionAccountId}`}
                  </span>
                  <button
                    onClick={() =>
                      unlinkContribMut.mutate({
                        budgetItemId: m.budgetItemId,
                      })
                    }
                    disabled={unlinkContribMut.isPending}
                    className="text-red-400 hover:text-red-600 text-[10px] whitespace-nowrap"
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
          <div className="space-y-0.5 border-t border-subtle pt-2">
            <p className="text-[10px] text-faint mb-1">
              {unlinkedContribs.length} unlinked contribution{" "}
              {unlinkedContribs.length === 1 ? "account" : "accounts"}
            </p>
            {unlinkedContribs.map((ca) => (
              <div
                key={ca.id}
                className="flex items-center gap-1.5 text-xs min-h-[24px]"
              >
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-elevated text-faint whitespace-nowrap">
                  Unlinked
                </span>
                <span className="text-secondary truncate min-w-[80px] max-w-[140px]">
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
                  className="flex-1 px-1 py-0.5 text-[11px] border border-strong rounded bg-surface-primary"
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
