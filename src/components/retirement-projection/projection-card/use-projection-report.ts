import { useEffect, useRef, useState } from "react";
import { checkReportGate } from "@/lib/pure/advice/report/mc-freshness";
import type { ReportGateFailure } from "@/lib/pure/advice/report/mc-freshness";
import type { ProjectionState, ReportMode } from "../projection-table-types";

export function useProjectionReport(state: ProjectionState) {
  const {
    projectionView,
    mcTaxMode,
    sharedInput,
    debouncedInput,
    engineQuery,
    mcQuery,
  } = state;
  // "basic" prints the chart and table; "advisor" mounts ReportRoot, hidden
  // on screen, and is reached only once checkReportGate passes, so a report
  // never prints with stale or missing simulation data.
  const [reportMode, setReportMode] = useState<ReportMode>("none");
  const [gateFailure, setGateFailure] = useState<ReportGateFailure | null>(
    null,
  );
  const originalTitleRef = useRef<string>("");
  // "Print Chart & Table" prints every year, whatever the table's own
  // milestone toggle shows; the toggle is put back after printing.
  const priorShowAllYearsRef = useRef<boolean | null>(null);
  const handlePrint = (mode: Exclude<ReportMode, "none">) => {
    originalTitleRef.current = document.title;
    setReportMode(mode);
    document.title = `Retirement Projection - ${new Date().toLocaleDateString()}`;
    if (mode === "basic" && !state.showAllYears) {
      priorShowAllYearsRef.current = state.showAllYears;
      state.setShowAllYears(true);
    }
    // Two rAFs: one for React to commit the report-only DOM, one for the
    // browser to paint it, before the print dialog captures the page.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.print());
    });
  };
  const handlePrintAdvisor = () => {
    const gate = checkReportGate({
      projectionView,
      mcTaxMode,
      sharedInput,
      debouncedInput,
      engineQuery: {
        isFetching: engineQuery.isFetching,
        isPlaceholderData: engineQuery.isPlaceholderData,
        data: engineQuery.data,
      },
      mcQuery: {
        isFetching: mcQuery.isFetching,
        data: mcQuery.data?.result ?? null,
      },
    });
    if (!gate.ok) {
      setGateFailure(gate.failure ?? null);
      return;
    }
    handlePrint("advisor");
  };
  useEffect(() => {
    const reset = () => {
      setReportMode("none");
      if (originalTitleRef.current) document.title = originalTitleRef.current;
      if (priorShowAllYearsRef.current != null) {
        state.setShowAllYears(priorShowAllYearsRef.current);
        priorShowAllYearsRef.current = null;
      }
    };
    window.addEventListener("afterprint", reset);
    return () => window.removeEventListener("afterprint", reset);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- state.setShowAllYears is a stable useState setter, safe to close over once
  }, []);
  return {
    reportMode,
    gateFailure,
    setGateFailure,
    handlePrint,
    handlePrintAdvisor,
  };
}
