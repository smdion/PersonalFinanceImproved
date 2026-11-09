"use client";

/**
 * Shared "Clone to new" behavior (name prompt → duplicate mutation → toast,
 * disabled while pending) for budget/salary/contribution profiles.
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

interface UseCloneProfileReturn {
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
