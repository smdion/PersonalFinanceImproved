"use client";

/** On a new unlinked SimpleFIN account that looks like a re-added
 *  institution's copy of an older one: offer to merge it into that one. */
import { trpc } from "@/lib/trpc";
import { errorText } from "@/lib/utils/mutation-error";
import { hasPermission, useUser } from "@/lib/context/user-context";
import { confirmWithDiff } from "@/components/ui/confirm-dialog";

export function ReaddedMergePrompt({
  account,
}: {
  account: { id: number; accountName: string };
}) {
  const { id: copyId, accountName } = account;
  const user = useUser();
  const utils = trpc.useUtils();
  const canMerge = hasPermission(user, "sync");
  const { data } = trpc.simplefin.listReaddedAccounts.useQuery(undefined, {
    enabled: canMerge,
  });
  const merge = trpc.simplefin.mergeReaddedAccount.useMutation({
    onSuccess: () => {
      utils.simplefin.invalidate();
      utils.mortgage.invalidate();
      utils.assets.invalidate();
    },
  });
  const candidates = data?.find((c) => c.copyId === copyId)?.candidates ?? [];
  if (!canMerge || candidates.length === 0) return null;

  const onMerge = async (keep: (typeof candidates)[number]) => {
    const ok = await confirmWithDiff(
      `Merge "${accountName}" into "${keep.accountName}"? This can't be undone.`,
      [
        `"${keep.accountName}" keeps its links and its history, and is counted like the new account.`,
        `"${accountName}"'s balances, holdings and transactions move to it, and it takes that account's SimpleFIN name and feed.`,
        `"${accountName}" goes from the list.`,
        `Only merge if "${keep.accountName}" is gone from SimpleFIN, not just missing from one sync.`,
      ],
      "Merge",
    );
    if (ok) merge.mutate({ copyId, keepId: keep.id });
  };

  return (
    <div className="text-caption text-muted mt-0.5 pl-6">
      {candidates.map((keep) => (
        <p key={keep.id}>
          Looks like a re-added account: merge into{" "}
          <span className="text-primary">{keep.accountName}</span>
          {keep.linked ? " (linked)" : ""}?{" "}
          <button
            className="hover:text-primary underline"
            disabled={merge.isPending}
            onClick={() => void onMerge(keep)}
          >
            Merge
          </button>
        </p>
      ))}
      {merge.error && <p className="text-red-600">{errorText(merge.error)}</p>}
    </div>
  );
}
