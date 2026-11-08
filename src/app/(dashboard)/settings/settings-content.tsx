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
import { IntegrationsSettings } from "@/components/settings/integrations";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, tabPanelProps } from "@/components/ui/tabs";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { SK_SETTINGS_ACTIVE_TAB } from "@/lib/constants/settings-keys";
import { useDeepLinkParam } from "@/components/settings/use-deep-link-param";
import {
  ADMIN_SETTINGS_TABS,
  SETTINGS_SECTION_PARAM,
  SETTINGS_TAB_PARAM,
  SETTINGS_TABS,
} from "@/lib/config/settings-sections";

const SECTION_PARAM_ONLY = [SETTINGS_SECTION_PARAM];

// "people" folded into General as a sub-item, and the admin "api" tab is
// gone (docs/API_ROUTERS.md is the API reference) — an existing user's
// SK_SETTINGS_ACTIVE_TAB may still hold either.
const OLD_GENERAL_TAB_KEYS = ["people", "api"];

export function SettingsContent() {
  const user = useUser();
  const admin = isAdmin(user);
  const tabs = admin
    ? [...SETTINGS_TABS, ...ADMIN_SETTINGS_TABS]
    : [...SETTINGS_TABS];
  const [persistedTab, setActiveTab] = useDeepLinkParam(
    SETTINGS_TAB_PARAM,
    tabs.map((t) => t.key),
    usePersistedSetting<string>(SK_SETTINGS_ACTIVE_TAB, "general"),
    SECTION_PARAM_ONLY,
  );
  const activeTab = OLD_TAX_TAB_KEYS.includes(persistedTab)
    ? "taxdata"
    : OLD_ACCESS_TAB_KEYS.includes(persistedTab)
      ? "access"
      : OLD_GENERAL_TAB_KEYS.includes(persistedTab)
        ? "general"
        : persistedTab;

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
      <div className="mb-6 border-b">
        <nav>
          <Tabs
            look="underline-nav"
            id="settings"
            value={activeTab}
            onChange={setActiveTab}
            tabs={tabs.map((tab) => ({ value: tab.key, label: tab.label }))}
          />
        </nav>
      </div>
      <div {...tabPanelProps("settings", activeTab)}>
        {activeTab === "general" && <GeneralSettings />}
        {activeTab === "taxdata" && <TaxDataSettings />}
        {activeTab === "integrations" && <IntegrationsSettings />}
        {activeTab === "access" && admin && <AccessControlSettings />}
        {activeTab === "debug" && admin && <DebugSettings />}
      </div>
    </div>
  );
}
