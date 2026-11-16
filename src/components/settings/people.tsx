"use client";

/** Settings tab for managing household members (name, date of birth, primary flag, spouse) using the generic DataTable with an inline person form. */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { FormField, FormInput, FormSelect } from "@/components/forms";
import { DataTable, DataTableFormActions } from "./data-table";

export function PeopleSettings() {
  const user = useUser();
  const admin = isAdmin(user);
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.people.list.useQuery();
  const deleteMut = trpc.people.delete.useMutation({
    onSuccess: () => utils.people.list.invalidate(),
  });
  const createMut = trpc.people.create.useMutation({
    onSuccess: () => utils.people.list.invalidate(),
  });
  const updateMut = trpc.people.update.useMutation({
    onSuccess: () => utils.people.list.invalidate(),
  });
  const spouseMut = trpc.people.setSpouse.useMutation({
    onSuccess: () => {
      utils.people.list.invalidate();
      utils.projection.invalidate();
      utils.retirement.invalidate();
    },
  });
  const people = data ?? [];
  const nameOf = (id: number | null) =>
    people.find((p) => p.id === id)?.name ?? null;

  return (
    <DataTable
      title="People"
      columns={[
        { key: "id", label: "ID" },
        { key: "name", label: "Name" },
        { key: "dateOfBirth", label: "Date of Birth" },
        {
          key: "isPrimaryUser",
          label: "Primary",
          render: (r) => (r.isPrimaryUser ? "Yes" : ""),
        },
        {
          key: "spousePersonId",
          label: "Spouse",
          render: (r) => {
            // Two people: the joint return's spouses are the two of them (shown, not chosen).
            if (people.length < 3) {
              const other = people.find((p) => p.id !== r.id);
              return other ? (
                <span
                  className="text-muted"
                  title="On a joint return, the spouses are the household's two people"
                >
                  {other.name} (if filing jointly)
                </span>
              ) : (
                ""
              );
            }
            if (!admin) return nameOf(r.spousePersonId) ?? "";
            return (
              <FormSelect
                aria-label={`${r.name}'s spouse`}
                title="Who files a joint return with this person: Social Security spousal benefits and the RMD spouse table use it"
                value={r.spousePersonId ?? ""}
                disabled={spouseMut.isPending}
                onChange={(e) =>
                  spouseMut.mutate({
                    id: r.id,
                    spousePersonId:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              >
                <option value="">None</option>
                {people
                  .filter((p) => p.id !== r.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </FormSelect>
            );
          },
        },
      ]}
      data={data}
      isLoading={isLoading}
      onDelete={admin ? (id) => deleteMut.mutate({ id }) : undefined}
      isDeleting={deleteMut.isPending}
      renderForm={
        admin
          ? (editing, onClose) => (
              <PersonForm
                initial={editing}
                onSubmit={(vals) => {
                  if (editing) {
                    updateMut.mutate(
                      { id: editing.id, ...vals },
                      { onSuccess: onClose },
                    );
                  } else {
                    createMut.mutate(vals, { onSuccess: onClose });
                  }
                }}
                onCancel={onClose}
                isPending={createMut.isPending || updateMut.isPending}
              />
            )
          : undefined
      }
    />
  );
}

function PersonForm({
  initial,
  onSubmit,
  onCancel,
  isPending,
}: {
  initial: { name: string; dateOfBirth: string; isPrimaryUser: boolean } | null;
  onSubmit: (v: {
    name: string;
    dateOfBirth: string;
    isPrimaryUser: boolean;
  }) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [dob, setDob] = useState(initial?.dateOfBirth ?? "");
  const [primary, setPrimary] = useState(initial?.isPrimaryUser ?? false);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, dateOfBirth: dob, isPrimaryUser: primary });
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <FormField label="Name">
        <FormInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </FormField>
      <FormField label="Date of Birth">
        <FormInput
          type="date"
          value={dob}
          onChange={(e) => setDob(e.target.value)}
          required
        />
      </FormField>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={primary}
          onChange={(e) => setPrimary(e.target.checked)}
        />
        Primary User
      </label>
      <DataTableFormActions
        className="flex gap-2"
        editing={initial !== null}
        isPending={isPending}
        onCancel={onCancel}
      />
    </form>
  );
}
