"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { DataTable } from "./data-table";

export function PeopleSettings() {
  const user = useUser();
  const admin = isAdmin(user);
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.settings.people.list.useQuery();
  const deleteMut = trpc.settings.people.delete.useMutation({
    onSuccess: () => utils.settings.people.list.invalidate(),
  });
  const createMut = trpc.settings.people.create.useMutation({
    onSuccess: () => utils.settings.people.list.invalidate(),
  });
  const updateMut = trpc.settings.people.update.useMutation({
    onSuccess: () => utils.settings.people.list.invalidate(),
  });

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
      className="flex flex-wrap gap-3 items-end"
    >
      <label className="flex flex-col text-sm">
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="mt-1 px-2 py-1 border rounded"
        />
      </label>
      <label className="flex flex-col text-sm">
        Date of Birth
        <input
          type="date"
          value={dob}
          onChange={(e) => setDob(e.target.value)}
          required
          className="mt-1 px-2 py-1 border rounded"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={primary}
          onChange={(e) => setPrimary(e.target.checked)}
        />
        Primary User
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {initial ? "Update" : "Create"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm border rounded hover:bg-surface-elevated"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
