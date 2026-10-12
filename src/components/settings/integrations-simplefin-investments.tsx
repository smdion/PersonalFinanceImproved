"use client";

/**
 * Settings → SimpleFIN → Transaction rules: the household's own rules for
 * how SimpleFIN investment transactions count, to review or delete. Rules
 * are made where transactions are decided — "always treat … this way" in
 * Update Performance / Update Basis — and holdings live on each Portfolio
 * account card. Needs the portfolio permission (mounted on the admin-only
 * Integrations page).
 */
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { INVESTMENT_TRANSACTION_KIND_LABELS } from "@/lib/config/display-labels";

function Rules() {
  const utils = trpc.useUtils();
  const { data: rules } = trpc.investments.listRules.useQuery();
  const remove = trpc.investments.deleteRule.useMutation({
    onSuccess: () => utils.investments.invalidate(),
  });
  if (!rules) return null;
  if (rules.length === 0)
    return (
      <p className="text-caption text-faint">
        No rules yet. When Update Performance or Update Basis asks about a
        transaction, tick &ldquo;always treat … this way&rdquo; to make one.
      </p>
    );
  return (
    <ul className="space-y-1 text-xs">
      {rules.map((r) => (
        <li key={r.id} className="flex items-baseline justify-between gap-2">
          <span className="text-muted">
            <span className="text-primary">{r.institutionContains}</span>{" "}
            {r.sign === "positive"
              ? "deposits"
              : r.sign === "negative"
                ? "withdrawals"
                : "rows"}{" "}
            containing{" "}
            <span className="text-primary">
              &ldquo;{r.descriptionContains}&rdquo;
            </span>{" "}
            are{" "}
            <span className="text-primary">
              {INVESTMENT_TRANSACTION_KIND_LABELS[r.kind]}
            </span>
          </span>
          <button
            className="text-faint shrink-0 hover:text-red-600"
            onClick={() => {
              if (
                confirm(
                  "Delete this rule? Matching rows go back to Ledgr's own rules.",
                )
              )
                remove.mutate({ id: r.id });
            }}
          >
            Delete
          </button>
        </li>
      ))}
    </ul>
  );
}

export function SimplefinInvestmentsCard() {
  return (
    <Card title="Transaction rules">
      <p className="text-muted mb-3 text-xs">
        How SimpleFIN investment transactions count — new money, money moved
        between your accounts, withdrawals, fees. Ledgr asks about the ones it
        isn&apos;t sure of when you update Performance or Basis; holdings are on
        each account&apos;s card in Portfolio.
      </p>
      <Rules />
    </Card>
  );
}
