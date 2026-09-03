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
        <div className="animate-pulse h-8 bg-surface-elevated rounded" />
        <div className="animate-pulse h-64 bg-surface-elevated rounded" />
      </div>
    );
  }

  if (!data || data.profiles.length === 0) {
    return <p className="text-caption text-faint italic">No profiles yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b-2 border-strong">
            <th className="text-left py-2 pl-4 pr-3 text-muted font-medium sticky left-0 bg-surface-primary">
              Account
            </th>
            {data.profiles.map((p) => (
              <th
                key={p.id}
                className="text-right py-2 px-3 text-muted font-medium whitespace-nowrap"
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
              className={`border-b border-subtle hover:bg-blue-50/60 transition-colors ${
                rowIdx % 2 === 1 ? "bg-surface-sunken/60" : "bg-surface-primary"
              }`}
            >
              <td className="py-1.5 pl-4 pr-3 text-secondary sticky left-0 bg-inherit whitespace-nowrap">
                {account.accountName}
                {!account.live.isActive && (
                  <>
                    <span
                      className="ml-1 text-micro text-amber-500 font-medium"
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
                      className="ml-1 text-micro text-green-500 hover:text-green-700 disabled:opacity-50"
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
                    className={`py-1.5 px-3 text-right font-mono whitespace-nowrap ${
                      hasValue && !isDisabled
                        ? "text-amber-600 font-medium"
                        : "text-faint"
                    }`}
                  >
                    {isDisabled ? (
                      <span className="text-micro px-1 py-0.5 rounded border border-strong text-muted font-semibold">
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
