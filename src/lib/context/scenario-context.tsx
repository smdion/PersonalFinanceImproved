"use client";

import React, { createContext, useContext, useState, useMemo } from "react";

import type { ViewMode } from "@/lib/calculators/types";
export type { ViewMode };

/**
 * Page-wide view state shared by the header and every page. Plans are not
 * held here: a Plan is a named set of profiles, applying it makes those the
 * active profiles (server-side), and which Plan is in use is derived from
 * the active profiles — see usePlans.
 */
type ScenarioContextValue = {
  /** Global view mode: projected year, year-end estimate or actual YTD. */
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
};

const ScenarioContext = createContext<ScenarioContextValue | null>(null);

export function useScenario() {
  const ctx = useContext(ScenarioContext);
  if (!ctx) throw new Error("useScenario must be used within ScenarioProvider");
  return ctx;
}

export function ScenarioProvider({ children }: { children: React.ReactNode }) {
  const [viewMode, setViewMode] = useState<ViewMode>("projected");
  const value = useMemo<ScenarioContextValue>(
    () => ({ viewMode, setViewMode }),
    [viewMode],
  );
  return (
    <ScenarioContext.Provider value={value}>
      {children}
    </ScenarioContext.Provider>
  );
}
