"use client";

/**
 * Contribution Profile compare: accounts × profiles from `getComparisonData`. "Not set"
 * is a real gap (accounts hold no value of their own); cells use
 * resolveContributionFieldDisplayState.
 */
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils/format";
import {
  resolveContributionFieldDisplayState,
  type ContributionAccountActiveFields,
} from "@/lib/pure/household/profiles";

export function ContributionProfileCompare() {
  const { data, isLoading } =
    trpc.contributionProfile.getComparisonData.useQuery();
  const utils = trpc.useUtils();
  const setAccountActive =
    trpc.settings.contributionAccounts.setActive.useMutation({
      onSuccess: () => {
        utils.settings.contributionAccounts.invalidate();
        utils.contributionProfile.invalidate();
      },
    });

  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="bg-surface-elevated h-8 animate-pulse rounded" />
        <div className="bg-surface-elevated h-64 animate-pulse rounded" />
      </div>
    );
  }

  if (!data || data.profiles.length === 0) {
    return <p className="text-caption text-faint italic">No profiles yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-strong border-b-2">
            <th className="text-muted bg-surface-primary sticky left-0 py-2 pr-3 pl-4 text-left font-medium">
              Account
            </th>
            {data.profiles.map((p) => (
              <th
                key={p.id}
                className="text-muted px-3 py-2 text-right font-medium whitespace-nowrap"
              >
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.accounts.map((account, rowIndex) => (
            <tr
              key={account.id}
              className={`border-subtle border-b transition-colors hover:bg-blue-50/60 ${
                rowIndex % 2 === 1
                  ? "bg-surface-sunken/60"
                  : "bg-surface-primary"
              }`}
            >
              <td className="text-secondary sticky left-0 bg-inherit py-1.5 pr-3 pl-4 whitespace-nowrap">
                {account.accountName}
                {!account.live.isActive && (
                  <>
                    <span
                      className="text-micro ml-1 font-medium text-amber-500"
                      title="This account isn't a funding target — any value set for it in any profile has no effect."
                    >
                      not a funding target
                    </span>
                    <button
                      onClick={() =>
                        setAccountActive.mutate({
                          id: account.id,
                          isActive: true,
                        })
                      }
                      disabled={setAccountActive.isPending}
                      className="text-micro ml-1 text-green-500 hover:text-green-700 disabled:opacity-50"
                    >
                      Restore as funding target
                    </button>
                  </>
                )}
              </td>
              {data.profiles.map((p) => {
                const activeFields = (p.accountActiveFields[
                  String(account.id)
                ] ?? null) as ContributionAccountActiveFields;
                const { hasValue, isDisabled, value, methodSuffix } =
                  resolveContributionFieldDisplayState(activeFields);
                return (
                  <td
                    key={p.id}
                    className={`px-3 py-1.5 text-right font-mono whitespace-nowrap ${
                      hasValue && !isDisabled
                        ? "font-medium text-amber-600"
                        : "text-faint"
                    }`}
                  >
                    {isDisabled ? (
                      <span className="text-micro border-strong text-muted rounded border px-1 py-0.5 font-semibold">
                        OFF HERE
                      </span>
                    ) : hasValue ? (
                      methodSuffix === "%" ? (
                        `${value}%`
                      ) : (
                        formatCurrency(parseFloat(String(value)))
                      )
                    ) : (
                      <span className="italic">Not set</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
