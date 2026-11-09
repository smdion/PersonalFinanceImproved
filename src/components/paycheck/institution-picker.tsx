"use client";

/**
 * Institution select-or-create picker for contribution accounts: filters compatible
 * performance accounts and offers inline "+ New institution" via CreateAccountForm.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { CreateAccountForm } from "@/components/portfolio/contribution-accounts-create-form";
import { FormField, FormSelect } from "@/components/forms";
import type { AccountCategory } from "@/lib/config/account-types";

export function InstitutionPicker({
  personId,
  accountType,
  value,
  onChange,
}: {
  /** null when the contribution account is joint-owned */
  personId: number | null;
  /** Only performance accounts of this same type are linkable — a
   *  brokerage contribution shouldn't be offered someone's HSA or 401k. */
  accountType: AccountCategory;
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const [creating, setCreating] = useState(false);
  const utils = trpc.useUtils();
  const { data: accounts } =
    trpc.performance.performanceAccounts.list.useQuery();
  const { data: people } = trpc.settings.people.list.useQuery();
  const createPerf = trpc.performance.performanceAccounts.create.useMutation({
    onSuccess: (created) => {
      utils.performance.performanceAccounts.invalidate();
      setCreating(false);
      if (created) onChange(created.id);
    },
  });

  // Same owner AND account type: an institution row is one (owner, type, institution)
  // account. Dormant ones (not contributed to) are excluded, except the selected value,
  // so re-opening an existing link doesn't blank the select.
  const compatible = (accounts ?? []).filter(
    (pa) =>
      (pa.ownerPersonId === personId || pa.ownerPersonId === null) &&
      pa.accountType === accountType &&
      (pa.isActive || pa.id === value),
  );

  if (creating) {
    return (
      <div className="col-span-2 rounded-lg border border-blue-200 bg-blue-50/30 p-3 md:col-span-3">
        <CreateAccountForm
          people={people ?? []}
          defaultAccountType={accountType}
          onSubmit={(vals) =>
            createPerf.mutate({
              ...vals,
              accountType: vals.accountType as AccountCategory,
            })
          }
          onCancel={() => setCreating(false)}
          isPending={createPerf.isPending}
        />
      </div>
    );
  }

  return (
    <FormField label="Institution">
      <div className="flex gap-2">
        <FormSelect
          value={value ?? ""}
          onChange={(e) =>
            onChange(e.target.value ? parseInt(e.target.value, 10) : null)
          }
          className="min-w-0 flex-1"
        >
          <option value="">No linked institution</option>
          {compatible.map((pa) => (
            <option key={pa.id} value={pa.id}>
              {pa.institution}
              {pa.label ? ` — ${pa.label}` : ""}
            </option>
          ))}
        </FormSelect>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="shrink-0 text-xs whitespace-nowrap text-blue-600 hover:text-blue-700"
        >
          + New
        </button>
      </div>
    </FormField>
  );
}
