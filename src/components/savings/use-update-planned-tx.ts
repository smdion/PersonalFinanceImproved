"use client";

import { trpc } from "@/lib/trpc";
import { type PlannedTxForm } from "./types";

function parseRecurrence(form: PlannedTxForm): number | null {
  if (!form.isRecurring || !form.recurrenceMonths) return null;
  return parseInt(form.recurrenceMonths, 10) || null;
}

export function useUpdatePlannedTx() {
  const utils = trpc.useUtils();
  const mut = trpc.savings.plannedTransactions.update.useMutation({
    onSuccess: () => utils.savings.invalidate(),
  });

  const onUpdateTx = async (id: number, form: PlannedTxForm): Promise<void> => {
    await mut.mutateAsync({
      id,
      goalId: form.goalId,
      transactionDate: form.transactionDate,
      amount: form.amount,
      description: form.description,
      isRecurring: form.isRecurring,
      recurrenceMonths: parseRecurrence(form),
    });
  };

  return { onUpdateTx, isPending: mut.isPending };
}
