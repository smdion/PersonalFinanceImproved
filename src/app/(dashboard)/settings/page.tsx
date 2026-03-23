"use client";

import { PeopleSettings } from "@/components/settings/people";
import { ContributionLimitsSettings } from "@/components/settings/contribution-limits";
import { TaxBracketsSettings } from "@/components/settings/tax-brackets";
import { GeneralSettings } from "@/components/settings/general";
import { DebugSettings } from "@/components/settings/debug";
import { RbacGroupsSettings } from "@/components/settings/rbac-groups";
import { ApiDocsSettings } from "@/components/settings/api-docs";
import { IntegrationsSettings } from "@/components/settings/integrations";
import { AuthSettings } from "@/components/settings/auth-settings";
import { ReturnRatesSettings } from "@/components/settings/return-rates";
import { LtcgBracketsSettings } from "@/components/settings/ltcg-brackets";
import { IrmaaBracketsSettings } from "@/components/settings/irmaa-brackets";
import { PageHeader } from "@/components/ui/page-header";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";

const baseTabs = [
  { key: "general", label: "General" },
  { key: "people", label: "People" },
  { key: "limits", label: "IRS Limits" },
  { key: "tax", label: "Tax Brackets" },
  { key: "ltcg", label: "LTCG Brackets" },
  { key: "irmaa", label: "IRMAA Tables" },
  { key: "returns", label: "Return Rates" },
  { key: "integrations", label: "Integrations" },
] as const;

export default function SettingsPage() {
  const user = useUser();
  const admin = isAdmin(user);
  const [activeTab, setActiveTab] = usePersistedSetting<string>(
    "settings_active_tab",
    "general",
  );
  const tabs = admin
    ? [
        ...baseTabs,
        { key: "auth" as const, label: "Auth" },
        { key: "debug" as const, label: "Debug" },
        { key: "rbac" as const, label: "RBAC" },
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
        {activeTab === "people" && <PeopleSettings />}
        {activeTab === "limits" && <ContributionLimitsSettings />}
        {activeTab === "tax" && <TaxBracketsSettings />}
        {activeTab === "ltcg" && <LtcgBracketsSettings />}
        {activeTab === "irmaa" && <IrmaaBracketsSettings />}
        {activeTab === "returns" && <ReturnRatesSettings />}
        {activeTab === "integrations" && <IntegrationsSettings />}
        {activeTab === "auth" && admin && <AuthSettings />}
        {activeTab === "debug" && admin && <DebugSettings />}
        {activeTab === "rbac" && admin && <RbacGroupsSettings />}
        {activeTab === "api" && admin && <ApiDocsSettings />}
      </div>
    </div>
  );
}
