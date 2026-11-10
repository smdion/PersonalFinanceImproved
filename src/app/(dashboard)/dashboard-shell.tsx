"use client";

import { ScenarioProvider } from "@/lib/context/scenario-context";
import { ScenarioBar } from "@/components/layout/scenario-bar";
import { QuickSearch } from "@/components/layout/quick-search";
import { usePrivacy } from "@/lib/context/privacy-context";
import { useHouseholdTimeZoneDefault } from "@/app/(dashboard)/use-household-timezone-default";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { privacy } = usePrivacy();
  useHouseholdTimeZoneDefault();
  return (
    <ScenarioProvider>
      {/* Keyed on privacy so toggling remounts the page and every
          formatCurrency call re-runs against the new flag. */}
      <div
        key={privacy ? "private" : "public"}
        className="flex h-full flex-col"
      >
        <ScenarioBar />
        <QuickSearch />
        {/* pl-12 clears the mobile hamburger and overflow-auto gives the page
            its own scroll region on screen; print drops both. */}
        <div className="flex-1 overflow-auto p-3 pl-12 md:p-4 print:overflow-visible print:p-0">
          {children}
        </div>
      </div>
    </ScenarioProvider>
  );
}
