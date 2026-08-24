"use client";

/**
 * useCloneProfile — shared "Clone to new" behavior for the three Budget-page
 * profile types (budget/salary/contribution). Each profile type has its own
 * tRPC duplicate procedure and its own row markup (the list-item components
 * aren't actually shared — different prop shapes), but the clone *behavior*
 * (name-prompt -> call duplicate mutation -> toast -> disable while pending)
 * is identical across all three, so only that half is centralized here.
 *
 *   const { clone, isPending } = useCloneProfile(
 *     trpc.salaryProfile.duplicate.useMutation({
 *       onSuccess: () => utils.salaryProfile.invalidate(),
 *     }),
 *   );
 *   <button onClick={() => clone(profile.id, profile.name)} disabled={isPending}>
 *     Clone to new
 *   </button>
 */

import { promptText } from "@/components/ui/confirm-dialog";
import { toast } from "@/lib/hooks/use-toast";

interface CloneMutation {
  mutateAsync: (input: {
    sourceProfileId: number;
    name: string;
  }) => Promise<unknown>;
  isPending: boolean;
}

export interface UseCloneProfileReturn {
  /** Prompts for a new name (pre-filled from the source), then fires the mutation. */
  clone: (sourceProfileId: number, currentName: string) => Promise<void>;
  isPending: boolean;
}

export function useCloneProfile(
  mutation: CloneMutation,
): UseCloneProfileReturn {
  const clone = async (sourceProfileId: number, currentName: string) => {
    const name = await promptText(
      "New profile name",
      undefined,
      `${currentName} (copy)`,
    );
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Profile name can't be empty");
      return;
    }
    try {
      await mutation.mutateAsync({ sourceProfileId, name: trimmed });
      toast.success(`Cloned "${trimmed}"`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to clone profile",
      );
    }
  };

  return { clone, isPending: mutation.isPending };
}
