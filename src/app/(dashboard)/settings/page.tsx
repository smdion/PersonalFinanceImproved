"use client";

/** Settings page with tabbed panels for managing people, tax brackets, contribution limits, and app config. */

import {
  TaxDataSettings,
  OLD_TAX_TAB_KEYS,
} from "@/components/settings/tax-data";
import {
  AccessControlSettings,
  OLD_ACCESS_TAB_KEYS,
} from "@/components/settings/access-control";
import { GeneralSettings } from "@/components/settings/general";
import { DebugSettings } from "@/components/settings/debug";
import { ApiDocsSettings } from "@/components/settings/api-docs";
import { IntegrationsSettings } from "@/components/settings/integrations";
import { PageHeader } from "@/components/ui/page-header";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { SK_SETTINGS_ACTIVE_TAB } from "@/lib/constants/settings-keys";

// Internal key stays "taxdata" (unchanged since the original Tax Data
// consolidation) even though the visible label is now "Reference Data" —
// Return Rates folded in alongside the 5 tax-year tables (see
// tax-data.tsx), and renaming the key itself would just be churn for no
// user-facing benefit.
const baseTabs = [
  { key: "general", label: "General" },
  { key: "taxdata", label: "Reference Data" },
  { key: "integrations", label: "Integrations" },
] as const;

// "people" folded into General as a sub-item — an existing user's
// SK_SETTINGS_ACTIVE_TAB may still hold it.
const OLD_GENERAL_TAB_KEYS = ["people"];

export default function SettingsPage() {
  const user = useUser();
  const admin = isAdmin(user);
  const [persistedTab, setActiveTab] = usePersistedSetting<string>(
    SK_SETTINGS_ACTIVE_TAB,
    "general",
  );
  const activeTab = OLD_TAX_TAB_KEYS.includes(persistedTab)
    ? "taxdata"
    : OLD_ACCESS_TAB_KEYS.includes(persistedTab)
      ? "access"
      : OLD_GENERAL_TAB_KEYS.includes(persistedTab)
        ? "general"
        : persistedTab;
  const tabs = admin
    ? [
        ...baseTabs,
        { key: "access" as const, label: "Access Control" },
        { key: "debug" as const, label: "Debug" },
        { key: "api" as const, label: "API" },
      ]
    : [...baseTabs];

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle={
          <>
            Cross-cutting reference data. Domain-specific settings live on their
            respective pages.
          </>
        }
      />
      <div className="border-b mb-6">
        <nav className="flex gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-muted hover:text-secondary hover:border-strong"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
      <div>
        {activeTab === "general" && <GeneralSettings />}
        {activeTab === "taxdata" && <TaxDataSettings />}
        {activeTab === "integrations" && <IntegrationsSettings />}
        {activeTab === "access" && admin && <AccessControlSettings />}
        {activeTab === "debug" && admin && <DebugSettings />}
        {activeTab === "api" && admin && <ApiDocsSettings />}
      </div>
    </div>
  );
}
