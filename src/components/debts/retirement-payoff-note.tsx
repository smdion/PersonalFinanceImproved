"use client";

/**
 * How the retirement projection treats this loan. The budget line that pays
 * it stops the year after payoff, once the household has said which line
 * that is; names don't say, so it's never guessed. A retirement budget typed
 * in as a figure has no lines, so it's left as entered.
 */
import { trpc } from "@/lib/trpc";

export function RetirementPayoffNote({
  loanId,
  payoffDate,
}: {
  loanId: number;
  payoffDate: string;
}) {
  const utils = trpc.useUtils();
  const { data } = trpc.budget.mortgageItemChoices.useQuery({ loanId });
  const setItem = trpc.budget.setMortgageItem.useMutation({
    onSuccess: () => {
      void utils.budget.mortgageItemChoices.invalidate({ loanId });
      void utils.projection.invalidate();
    },
  });
  if (!data) return null;
  const endsYear = Number(payoffDate.slice(0, 4)) + 1;
  const linked = data.budgets.some((b) => b.linkedItemId !== null);
  return (
    <div className="text-caption text-muted mt-3">
      {data.budgets.map((budget) => (
        <label
          key={budget.budgetProfileId}
          className="mt-1 flex flex-wrap items-center gap-2"
        >
          This payment in {budget.name}
          <select
            className="rounded border px-1.5 py-0.5"
            value={budget.linkedItemId ?? ""}
            disabled={setItem.isPending}
            onChange={(e) =>
              setItem.mutate({
                budgetProfileId: budget.budgetProfileId,
                loanId,
                itemId: e.target.value === "" ? null : Number(e.target.value),
              })
            }
          >
            <option value="">Not in this budget</option>
            {budget.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      ))}
      <p className="mt-1">
        {linked
          ? `Your retirement projection stops spending this payment from ${endsYear}. Taxes and insurance stay.`
          : "Pick the line that pays this loan and your retirement projection stops spending it after payoff."}
        {data.retirementTyped
          ? " A Retirement budget you typed in as an amount stays as entered."
          : ""}
      </p>
    </div>
  );
}
