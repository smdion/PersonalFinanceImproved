"use client";

/**
 * Account-order control for the `withdrawalOrder` array the engine reads: a session override in
 * Withdrawal Routing, the saved default in the profile's Taxes in Retirement panel.
 */
import { AccountBadge } from "@/components/ui/account-badge";
import type { AccountCategory } from "@/lib/config/account-types";

export function WithdrawalOrderEditor({
  order,
  onChange,
  filter,
  disabled,
}: {
  order: AccountCategory[];
  onChange: (order: AccountCategory[]) => void;
  /** Show and reorder only these categories (bracket_filling's Traditional order) within the full
   *  `withdrawalOrder`; a swap permutes only their slots, others keep their positions.
   *  Omitted = full-order editor. */
  filter?: AccountCategory[];
  disabled?: boolean;
}) {
  const filterSet = filter ? new Set(filter) : null;
  const visible = filterSet ? order.filter((c) => filterSet.has(c)) : order;

  function swapWithPrevious(index: number) {
    if (disabled) return;
    if (!filterSet) {
      const next = [...order];
      [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
      onChange(next);
      return;
    }
    // Filtered mode: find where these two categories actually sit in the
    // FULL array (not necessarily adjacent there — an unfiltered category
    // may sit between them) and swap only those two slots.
    const a = visible[index - 1]!;
    const b = visible[index]!;
    const posA = order.indexOf(a);
    const posB = order.indexOf(b);
    const next = [...order];
    next[posA] = b;
    next[posB] = a;
    onChange(next);
  }

  return (
    <div className="flex items-center gap-1">
      {visible.map((cat, index) => (
        <span key={cat} className="flex items-center gap-0.5">
          {index > 0 && <span className="text-faint mx-0.5">&rarr;</span>}
          <AccountBadge type={cat} />
          {index > 0 && (
            <button
              type="button"
              onClick={() => swapWithPrevious(index)}
              disabled={disabled}
              className="text-faint p-0.5 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
              title={`Move ${cat} left`}
            >
              <svg
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
