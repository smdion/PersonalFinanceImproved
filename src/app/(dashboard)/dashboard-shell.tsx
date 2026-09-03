"use client";

import { ScenarioProvider } from "@/lib/context/scenario-context";
import { ScenarioBar } from "@/components/layout/scenario-bar";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <ScenarioProvider>
      <div className="flex h-full flex-col">
        <ScenarioBar />
        {/* print:p-0 print:overflow-visible — pl-12/overflow-auto exist to
            clear the mobile hamburger button and give the page its own
            scroll region on screen; neither belongs in print (found live,
            2026-08-31: printed content sat shifted right with a leftover
            scrollbar-constrained box). */}
        <div className="flex-1 overflow-auto p-3 pl-12 md:p-4 print:overflow-visible print:p-0">
          {children}
        </div>
      </div>
    </ScenarioProvider>
  );
}
