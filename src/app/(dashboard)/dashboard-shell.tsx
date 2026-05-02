"use client";

import { ScenarioProvider } from "@/lib/context/scenario-context";
import { ScenarioBar } from "@/components/layout/scenario-bar";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <ScenarioProvider>
      <div className="flex flex-col h-full">
        <ScenarioBar />
        <div className="flex-1 overflow-auto p-3 pl-12 md:p-4">{children}</div>
      </div>
    </ScenarioProvider>
  );
}
