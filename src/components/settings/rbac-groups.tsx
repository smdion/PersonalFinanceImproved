"use client";

/** Settings tab for configuring RBAC by mapping Authentik OIDC group names to app permissions (admin, scenario, portfolio, etc.), with setup instructions and reset-to-defaults. */
import React, { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export function RbacGroupsSettings() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.settings.rbacGroups.get.useQuery();
  const upsert = trpc.settings.appSettings.upsert.useMutation({
    onSuccess: () => {
      utils.settings.rbacGroups.get.invalidate();
      utils.settings.appSettings.list.invalidate();
    },
  });
  const deleteSetting = trpc.settings.appSettings.delete.useMutation({
    onSuccess: () => {
      utils.settings.rbacGroups.get.invalidate();
      utils.settings.appSettings.list.invalidate();
    },
  });

  const [adminGroup, setAdminGroup] = useState("");
  const [permGroups, setPermGroups] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  // Sync local state when query data changes
  useEffect(() => {
    if (!data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync external data to local state
    setAdminGroup(data.adminGroup);
    const groups: Record<string, string> = {};
    for (const p of data.permissions) {
      groups[p.permission] = p.group;
    }
    setPermGroups(groups);
    setDirty(false);
  }, [data]);

  if (isLoading || !data) {
    return <Skeleton className="h-6 w-48" />;
  }

  const handleSave = async () => {
    // Save admin group
    if (adminGroup !== "ledgr-admin") {
      await upsert.mutateAsync({ key: "rbac_admin_group", value: adminGroup });
    } else if (data.isAdminCustom) {
      await deleteSetting.mutateAsync({ key: "rbac_admin_group" });
    }

    // Save permission groups
    for (const p of data.permissions) {
      const currentValue = permGroups[p.permission] ?? "";
      const defaultValue = `ledgr-${p.permission}`;
      if (currentValue !== defaultValue) {
        await upsert.mutateAsync({
          key: `rbac_group_${p.permission}`,
          value: currentValue,
        });
      } else if (p.isCustom) {
        await deleteSetting.mutateAsync({ key: `rbac_group_${p.permission}` });
      }
    }

    setDirty(false);
  };

  const handleReset = () => {
    setAdminGroup("ledgr-admin");
    const groups: Record<string, string> = {};
    for (const p of data.permissions) {
      groups[p.permission] = `ledgr-${p.permission}`;
    }
    setPermGroups(groups);
    setDirty(true);
  };

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted -mt-2">
        Assumes the Authentik OIDC connection is already set up (see the{" "}
        <strong>Authentik</strong> section) — this covers mapping its groups to
        app permissions.
      </p>

      {/* RBAC setup guide */}
      <div className="border border-blue-200 bg-blue-50 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-blue-900 mb-2">
          RBAC Group Setup
        </h3>
        <ol className="text-xs text-blue-800 space-y-1.5 list-decimal list-inside">
          <li>
            In Authentik, go to <strong>Directory &rarr; Groups</strong> and
            create groups matching the names below (e.g.{" "}
            <code className="bg-blue-100 px-1 rounded">ledgr-admin</code>).
          </li>
          <li>
            Assign users to the <strong>Admin</strong> group for full access, or
            to individual permission groups for selective access.
          </li>
          <li>
            Permissions are additive &mdash; a user in both{" "}
            <strong>Scenario</strong> and <strong>Portfolio</strong> groups can
            manage both. Admin implicitly has all permissions.
          </li>
          <li>Users not in any group are read-only viewers.</li>
          <li>
            Group name changes below take effect on next user login (existing
            sessions keep their current permissions).
          </li>
        </ol>
        <div className="mt-3 text-xs text-blue-700">
          <strong>Permission scope:</strong>
        </div>
        <ul className="text-xs text-blue-700 mt-1 space-y-0.5 list-disc list-inside ml-2">
          <li>
            <strong>Scenario</strong> &mdash; Create, edit, delete scenarios and
            overrides
          </li>
          <li>
            <strong>Portfolio</strong> &mdash; Create and delete portfolio
            snapshots
          </li>
          <li>
            <strong>Performance</strong> &mdash; Manage performance accounts and
            annual entries
          </li>
          <li>
            <strong>Budget</strong> &mdash; Edit budget items, columns, and
            modes
          </li>
          <li>
            <strong>Savings</strong> &mdash; Manage savings goals, allocations,
            and planned transactions
          </li>
          <li>
            <strong>Brokerage</strong> &mdash; Manage brokerage goals and
            planned transactions
          </li>
          <li>
            <strong>Version</strong> &mdash; Create, restore, and delete data
            versions; import/export backups
          </li>
          <li>
            <strong>ContributionProfile</strong> &mdash; Create, edit, and
            delete contribution profiles (what-if salary/contribution scenarios)
          </li>
        </ul>
      </div>

      <Card title="Authentik Group Mapping">
        <p className="text-xs text-muted mb-4">
          Map Authentik group names to app permissions. Customize if your
          Authentik groups use different naming conventions.
        </p>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-secondary w-32 shrink-0">
              Admin
            </label>
            <input
              type="text"
              value={adminGroup}
              onChange={(e) => {
                setAdminGroup(e.target.value);
                setDirty(true);
              }}
              className="flex-1 text-sm border border-strong rounded px-3 py-1.5 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              placeholder="ledgr-admin"
            />
          </div>

          {data.permissions.map((p) => (
            <div key={p.permission} className="flex items-center gap-3">
              <label className="text-sm font-medium text-secondary w-32 shrink-0 capitalize">
                {p.permission}
              </label>
              <input
                type="text"
                value={permGroups[p.permission] ?? ""}
                onChange={(e) => {
                  setPermGroups((prev) => ({
                    ...prev,
                    [p.permission]: e.target.value,
                  }));
                  setDirty(true);
                }}
                className="flex-1 text-sm border border-strong rounded px-3 py-1.5 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                placeholder={`ledgr-${p.permission}`}
              />
              {p.isCustom && (
                <Badge color="amber" size="sm" case="normal">
                  custom
                </Badge>
              )}
            </div>
          ))}
        </div>

        <div className="flex gap-2 mt-4 pt-3 border-t border-subtle">
          <button
            onClick={handleSave}
            disabled={!dirty || upsert.isPending}
            className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {upsert.isPending ? "Saving..." : "Save"}
          </button>
          <button
            onClick={handleReset}
            className="px-3 py-1.5 text-xs font-medium text-muted bg-surface-elevated rounded hover:bg-surface-strong"
          >
            Reset to Defaults
          </button>
        </div>
      </Card>
    </div>
  );
}
