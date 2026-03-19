"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
} from "react";
import { trpc } from "@/lib/trpc";
import type { ScenarioOverrides } from "@/lib/db/schema";

export type ViewMode = "projected" | "ytd";

type Scenario = {
  id: number;
  name: string;
  description: string | null;
  overrides: ScenarioOverrides;
  isBaseline: boolean;
  createdAt: string;
  updatedAt: string;
};

type SessionScenario = {
  id: string; // e.g. "session-1"
  name: string;
  description: string | null;
  overrides: ScenarioOverrides;
  isSession: true;
};

type ActiveScenario =
  | { type: "main" }
  | { type: "persisted"; id: number }
  | { type: "session"; id: string };

type ScenarioContextValue = {
  /** Currently active scenario selection */
  activeSelection: ActiveScenario;
  /** The resolved active scenario (null = Main Plan) */
  activeScenario: (Scenario | SessionScenario) | null;
  /** All persisted scenarios from DB */
  persistedScenarios: Scenario[];
  /** All session-only scenarios */
  sessionScenarios: SessionScenario[];
  /** Switch active scenario */
  setActive: (selection: ActiveScenario) => void;

  /** Global view mode: projected year vs actual YTD */
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  /** Get the effective value for an entity field, applying scenario override if active */
  getOverride: <T>(
    entity: string,
    recordId: string | number,
    field: string,
    mainValue: T,
  ) => T;
  /** Check if a field is overridden in the active scenario */
  isOverridden: (
    entity: string,
    recordId: string | number,
    field: string,
  ) => boolean;
  /** Set an override in the active scenario (writes to DB for persisted, state for session) */
  setOverride: (
    entity: string,
    recordId: string | number,
    field: string,
    value: string | number | boolean | null,
  ) => void;
  /** Clear an override in the active scenario */
  clearOverride: (
    entity: string,
    recordId: string | number,
    field: string,
  ) => void;

  /** Create a new session-only scenario, optionally with initial overrides */
  createSessionScenario: (
    name: string,
    initialOverrides?: ScenarioOverrides,
  ) => string;
  /** Delete a session scenario */
  deleteSessionScenario: (id: string) => void;

  /** Whether we're in a scenario (not main plan) */
  isInScenario: boolean;
};

const ScenarioContext = createContext<ScenarioContextValue | null>(null);

export function useScenario() {
  const ctx = useContext(ScenarioContext);
  if (!ctx) throw new Error("useScenario must be used within ScenarioProvider");
  return ctx;
}

/** Convenience hook: get override value or main value */
export function useScenarioValue<T>(
  entity: string,
  recordId: string | number,
  field: string,
  mainValue: T,
): T {
  const { getOverride } = useScenario();
  return getOverride(entity, recordId, field, mainValue);
}

let sessionCounter = 0;

export function ScenarioProvider({ children }: { children: React.ReactNode }) {
  const [activeSelection, setActiveSelection] = useState<ActiveScenario>({
    type: "main",
  });
  const [viewMode, setViewMode] = useState<ViewMode>("projected");
  const [sessionScenarios, setSessionScenarios] = useState<SessionScenario[]>(
    [],
  );

  // Fetch persisted scenarios from DB
  const { data: persistedScenarios = [] } =
    trpc.settings.scenarios.list.useQuery(undefined, {
      staleTime: 30_000,
    });

  // Mutations for persisted scenario overrides
  const setOverrideMut = trpc.settings.scenarios.setOverride.useMutation();
  const clearOverrideMut = trpc.settings.scenarios.clearOverride.useMutation();
  const utils = trpc.useUtils();

  // Resolve the active scenario object
  const activeScenario = useMemo(() => {
    if (activeSelection.type === "main") return null;
    if (activeSelection.type === "persisted") {
      return (
        persistedScenarios.find((s) => s.id === activeSelection.id) ?? null
      );
    }
    return sessionScenarios.find((s) => s.id === activeSelection.id) ?? null;
  }, [activeSelection, persistedScenarios, sessionScenarios]);

  const getOverrides = useCallback((): ScenarioOverrides => {
    return activeScenario?.overrides ?? {};
  }, [activeScenario]);

  const getOverride = useCallback(
    <T,>(
      entity: string,
      recordId: string | number,
      field: string,
      mainValue: T,
    ): T => {
      const overrides = getOverrides();
      const val = overrides[entity]?.[String(recordId)]?.[field];
      if (val === undefined) return mainValue;
      return val as T;
    },
    [getOverrides],
  );

  const isOverridden = useCallback(
    (entity: string, recordId: string | number, field: string): boolean => {
      const overrides = getOverrides();
      return overrides[entity]?.[String(recordId)]?.[field] !== undefined;
    },
    [getOverrides],
  );

  const setOverride = useCallback(
    (
      entity: string,
      recordId: string | number,
      field: string,
      value: string | number | boolean | null,
    ) => {
      if (activeSelection.type === "main") return; // Can't set overrides on main plan

      if (activeSelection.type === "persisted") {
        // Optimistic update + DB mutation
        setOverrideMut.mutate(
          {
            id: activeSelection.id,
            entity,
            recordId: String(recordId),
            field,
            value,
          },
          { onSuccess: () => utils.settings.scenarios.list.invalidate() },
        );
      } else {
        // Session scenario — update local state
        setSessionScenarios((prev) =>
          prev.map((s) => {
            if (s.id !== activeSelection.id) return s;
            const overrides = { ...s.overrides };
            if (!overrides[entity]) overrides[entity] = {};
            if (!overrides[entity]![String(recordId)])
              overrides[entity]![String(recordId)] = {};
            overrides[entity]![String(recordId)]![field] = value;
            return { ...s, overrides };
          }),
        );
      }
    },
    [activeSelection, setOverrideMut, utils],
  );

  const clearOverride = useCallback(
    (entity: string, recordId: string | number, field: string) => {
      if (activeSelection.type === "main") return;

      if (activeSelection.type === "persisted") {
        clearOverrideMut.mutate(
          { id: activeSelection.id, entity, recordId: String(recordId), field },
          { onSuccess: () => utils.settings.scenarios.list.invalidate() },
        );
      } else {
        setSessionScenarios((prev) =>
          prev.map((s) => {
            if (s.id !== activeSelection.id) return s;
            const overrides = { ...s.overrides };
            delete overrides[entity]?.[String(recordId)]?.[field];
            // Clean up empty branches
            if (
              overrides[entity]?.[String(recordId)] &&
              Object.keys(overrides[entity]![String(recordId)]!).length === 0
            ) {
              delete overrides[entity]![String(recordId)];
            }
            if (
              overrides[entity] &&
              Object.keys(overrides[entity]!).length === 0
            ) {
              delete overrides[entity];
            }
            return { ...s, overrides };
          }),
        );
      }
    },
    [activeSelection, clearOverrideMut, utils],
  );

  const createSessionScenario = useCallback(
    (name: string, initialOverrides?: ScenarioOverrides): string => {
      const id = `session-${++sessionCounter}`;
      setSessionScenarios((prev) => [
        ...prev,
        {
          id,
          name,
          description: null,
          overrides: initialOverrides ?? {},
          isSession: true as const,
        },
      ]);
      return id;
    },
    [],
  );

  const deleteSessionScenario = useCallback(
    (id: string) => {
      setSessionScenarios((prev) => prev.filter((s) => s.id !== id));
      if (activeSelection.type === "session" && activeSelection.id === id) {
        setActiveSelection({ type: "main" });
      }
    },
    [activeSelection],
  );

  const value = useMemo<ScenarioContextValue>(
    () => ({
      activeSelection,
      activeScenario,
      persistedScenarios: persistedScenarios as Scenario[],
      sessionScenarios,
      setActive: setActiveSelection,
      viewMode,
      setViewMode,
      getOverride,
      isOverridden,
      setOverride,
      clearOverride,
      createSessionScenario,
      deleteSessionScenario,
      isInScenario: activeSelection.type !== "main",
    }),
    [
      activeSelection,
      activeScenario,
      persistedScenarios,
      sessionScenarios,
      viewMode,
      getOverride,
      isOverridden,
      setOverride,
      clearOverride,
      createSessionScenario,
      deleteSessionScenario,
    ],
  );

  return (
    <ScenarioContext.Provider value={value}>
      {children}
    </ScenarioContext.Provider>
  );
}
