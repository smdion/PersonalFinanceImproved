"use client";

/**
 * Utilities ▸ add a utility: the kind (each once), who provides it and
 * the unit its usage is billed in. Its bills are added on its own card, or
 * pulled from the budget (UtilityFeedCard). Admins only, as the router.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { FormField, FormInput, FormSelect } from "@/components/forms";
import {
  UTILITY_KIND_VALUES,
  UTILITY_UNIT_VALUES,
  UTILITY_USUAL_UNIT,
  type UtilityKind,
  type UtilityUnit,
} from "@/lib/config/enum-values";

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function AddUtilityForm({
  existingKinds,
}: {
  existingKinds: readonly string[];
}) {
  const admin = isAdmin(useUser());
  const utils = trpc.useUtils();
  const available = UTILITY_KIND_VALUES.filter(
    (k) => !existingKinds.includes(k),
  );
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<UtilityKind | "">("");
  const [provider, setProvider] = useState("");
  const [unit, setUnit] = useState<UtilityUnit | "">("");
  const add = trpc.utilities.upsertService.useMutation({
    onSuccess: () => {
      utils.utilities.invalidate();
      setOpen(false);
      setKind("");
      setProvider("");
      setUnit("");
    },
  });

  if (!admin || available.length === 0) return null;
  const chosenKind = kind || available[0]!;
  if (!open)
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        + Add a utility
      </Button>
    );

  return (
    <form
      className="flex flex-wrap items-end gap-3 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        if (!provider.trim()) return;
        add.mutate({
          kind: chosenKind,
          providerName: provider.trim(),
          usageUnit: unit || UTILITY_USUAL_UNIT[chosenKind],
        });
      }}
    >
      <FormField label="Utility">
        <FormSelect
          value={chosenKind}
          onChange={(e) => {
            setKind(e.target.value as UtilityKind);
            setUnit("");
          }}
        >
          {available.map((k) => (
            <option key={k} value={k}>
              {capitalize(k)}
            </option>
          ))}
        </FormSelect>
      </FormField>
      <FormField label="Provider">
        <FormInput
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          placeholder="Who bills you"
          required
        />
      </FormField>
      <FormField label="Usage unit">
        <FormSelect
          value={unit || UTILITY_USUAL_UNIT[chosenKind]}
          onChange={(e) => setUnit(e.target.value as UtilityUnit)}
        >
          {UTILITY_UNIT_VALUES.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </FormSelect>
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={add.isPending}>
          Add
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
      <FormError
        error={add.error}
        prefix="Failed to add utility"
        className="w-full"
      />
    </form>
  );
}
