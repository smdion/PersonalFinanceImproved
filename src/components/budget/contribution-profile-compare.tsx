"use client";

/**
 * Contribution Profile compare view — accounts as rows, profiles as
 * columns, each cell showing that profile's own active value for the
 * account, or "Not set" when the profile has no value for it at all. A
 * standing audit tool, not just a pre-swap warning: lets you sanity-check
 * coverage across every profile at once, not one at a time — "Not set" is
 * a real gap to flag, not a benign fallback, since accounts carry no value
 * of their own (see applyContribActiveFields).
 *
 * Kept as its own file rather than folded into contribution-profile-manager.tsx
 * (already ~1,457 lines, near the 1,500-line pnpm check:file-size warn
 * threshold) — see that file's `compareData` query, the single shared data
 * source this and the swap-time diff both consume.
 *
 * Cell display state (hasActiveFields/value, amber highlight when set,
 * DISABLED badge when isActive:false) is resolved via the same
 * resolveContribFieldDisplayState ProfileDetailPanel's per-account row in
 * contribution-profile-manager.tsx uses — just applied per cell instead of
 * per row-of-one-profile.
 */
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils/format";
import {
  resolveContribFieldDisplayState,
  type ContribAccountActiveFields,
} from "@/lib/pure/profiles";

export function ContributionProfileCompare() {
  const { data, isLoading } = trpc.contributionProfile.compareData.useQuery();
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
          {data.accounts.map((account, rowIdx) => (
            <tr
              key={account.id}
              className={`border-subtle border-b transition-colors hover:bg-blue-50/60 ${
                rowIdx % 2 === 1 ? "bg-surface-sunken/60" : "bg-surface-primary"
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
                ] ?? null) as ContribAccountActiveFields;
                const { hasValue, isDisabled, value, methodSuffix } =
                  resolveContribFieldDisplayState(activeFields);
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
