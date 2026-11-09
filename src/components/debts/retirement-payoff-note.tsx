"use client";

/**
 * How the retirement projection treats this loan: its paying budget line stops the year after
 * payoff once the household names that line (never guessed); a figure-only budget is as entered.
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
  const { data } = trpc.budget.listMortgageItemChoices.useQuery({ loanId });
  const setItem = trpc.budget.setMortgageItem.useMutation({
    onSuccess: () => {
      void utils.budget.listMortgageItemChoices.invalidate({ loanId });
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
