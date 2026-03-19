"use client";

import React, { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";

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

  useEffect(() => {
    if (data) {
      setAdminGroup(data.adminGroup);
      const groups: Record<string, string> = {};
      for (const p of data.permissions) {
        groups[p.permission] = p.group;
      }
      setPermGroups(groups);
      setDirty(false);
    }
  }, [data]);

  if (isLoading || !data) {
    return (
      <div className="text-sm text-muted">Loading RBAC configuration...</div>
    );
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
      {/* Authentik OIDC provider setup */}
      <div className="border bg-surface-sunken rounded-lg p-4">
        <h3 className="text-sm font-semibold text-primary mb-2">
          Authentik OIDC Provider Setup
        </h3>
        <ol className="text-xs text-secondary space-y-1.5 list-decimal list-inside">
          <li>
            In Authentik, go to <strong>Applications &rarr; Providers</strong>{" "}
            and create a new <strong>OAuth2/OpenID Provider</strong>.
          </li>
          <li>
            Set the <strong>Redirect URI</strong> to{" "}
            <code className="bg-surface-strong px-1 rounded">
              https://&lt;your-app-domain&gt;/api/auth/callback/authentik
            </code>
            .
          </li>
          <li>
            Under <strong>Advanced protocol settings</strong>, add{" "}
            <code className="bg-surface-strong px-1 rounded">groups</code> to
            the <strong>Scopes</strong> list so group membership is included in
            the OIDC token.
          </li>
          <li>
            Create an <strong>Application</strong> linked to this provider.
          </li>
          <li>
            Copy the <strong>Client ID</strong>, <strong>Client Secret</strong>,
            and <strong>OpenID Configuration Issuer</strong> URL.
          </li>
          <li>
            Set three environment variables on the app server:
            <div className="mt-1 ml-4 space-y-0.5 font-mono">
              <div>
                <code className="bg-surface-strong px-1 rounded">
                  AUTH_AUTHENTIK_ISSUER
                </code>{" "}
                &mdash; Issuer URL (e.g.{" "}
                <code className="bg-surface-strong px-1 rounded">
                  https://auth.example.com/application/o/ledgr/
                </code>
                )
              </div>
              <div>
                <code className="bg-surface-strong px-1 rounded">
                  AUTH_AUTHENTIK_ID
                </code>{" "}
                &mdash; Client ID from the provider
              </div>
              <div>
                <code className="bg-surface-strong px-1 rounded">
                  AUTH_AUTHENTIK_SECRET
                </code>{" "}
                &mdash; Client Secret from the provider
              </div>
            </div>
          </li>
          <li>
            Restart the app. The login page will now redirect to Authentik
            instead of using dev auto-login.
          </li>
        </ol>
        <p className="text-xs text-muted mt-2 italic">
          Without these env vars, the app runs in dev mode with automatic admin
          login.
        </p>
      </div>

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
                <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                  custom
                </span>
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
