"use client";

import React, { useState, useRef, useEffect } from "react";
import { useScenario } from "@/lib/context/scenario-context";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { trpc } from "@/lib/trpc";
import { confirm } from "@/components/ui/confirm-dialog";

export function ScenarioBar() {
  const {
    activeSelection,
    activeScenario,
    persistedScenarios,
    sessionScenarios,
    setActive,
    viewMode,
    setViewMode,
    createSessionScenario,
    deleteSessionScenario,
    isInScenario,
  } = useScenario();

  const user = useUser();
  const canManageScenarios = hasPermission(user, "scenario");

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [creating, setCreating] = useState<"persisted" | "session" | null>(
    null,
  );
  const [newName, setNewName] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const createMut = trpc.settings.scenarios.create.useMutation();
  const deleteMut = trpc.settings.scenarios.delete.useMutation();
  const utils = trpc.useUtils();

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
        setCreating(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Focus input when creating
  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const handleCreate = () => {
    if (!newName.trim() || !creating) return;
    if (creating === "persisted") {
      createMut.mutate(
        { name: newName.trim() },
        {
          onSuccess: (scenario) => {
            utils.settings.scenarios.list.invalidate();
            if (scenario) setActive({ type: "persisted", id: scenario.id });
            setNewName("");
            setCreating(null);
          },
        },
      );
    } else {
      const id = createSessionScenario(newName.trim());
      setActive({ type: "session", id });
      setNewName("");
      setCreating(null);
    }
  };

  const handleDelete = async (
    type: "persisted" | "session",
    id: number | string,
  ) => {
    if (!(await confirm("Delete this scenario?"))) return;
    if (type === "persisted") {
      deleteMut.mutate(
        { id: id as number },
        { onSuccess: () => utils.settings.scenarios.list.invalidate() },
      );
      if (activeSelection.type === "persisted" && activeSelection.id === id) {
        setActive({ type: "main" });
      }
    } else {
      deleteSessionScenario(id as string);
    }
  };

  const activeLabel = activeScenario ? activeScenario.name : "Main Plan";

  const overrideCount = activeScenario
    ? Object.values(activeScenario.overrides).reduce(
        (sum, entity) =>
          sum +
          Object.values(entity).reduce(
            (s, fields) => s + Object.keys(fields).length,
            0,
          ),
        0,
      )
    : 0;

  return (
    <div
      className={`flex items-center justify-end px-3 sm:px-4 py-1.5 gap-3 border-b text-xs ${isInScenario ? "bg-amber-50 border-amber-200" : "bg-surface-primary border-default"}`}
    >
      {/* Scenario selector — pill style matching view toggle */}
      <div className="flex items-center gap-2" ref={dropdownRef}>
        <span className="text-faint hidden sm:inline" id="plan-label">
          Plan:
        </span>
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            aria-haspopup="listbox"
            aria-expanded={dropdownOpen}
            aria-labelledby="plan-label"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] transition-colors ${
              isInScenario
                ? "bg-amber-100 text-amber-800 shadow-sm"
                : "bg-surface-primary text-primary shadow-sm"
            }`}
          >
            {isInScenario && (
              <svg
                className="w-3 h-3 text-amber-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              </svg>
            )}
            <span className="font-medium">{activeLabel}</span>
            {isInScenario && overrideCount > 0 && (
              <span className="bg-amber-200 text-amber-700 px-1 rounded text-[10px]">
                {overrideCount}
              </span>
            )}
            <svg
              className="w-3 h-3 text-faint"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          {dropdownOpen && (
            <div
              className="absolute top-full right-0 mt-1 w-64 max-w-[calc(100vw-2rem)] bg-surface-primary border rounded-lg shadow-lg z-50"
              role="listbox"
              aria-label="Scenario selection"
            >
              {/* Main Plan */}
              <button
                role="option"
                aria-selected={activeSelection.type === "main"}
                onClick={() => {
                  setActive({ type: "main" });
                  setDropdownOpen(false);
                }}
                className={`w-full text-left px-3 py-2 hover:bg-surface-sunken flex items-center gap-2 rounded-t-lg ${
                  activeSelection.type === "main"
                    ? "bg-blue-50 text-blue-700"
                    : "text-secondary"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                Main Plan
                {activeSelection.type === "main" && (
                  <span className="ml-auto text-[10px] text-blue-500">
                    Active
                  </span>
                )}
              </button>

              {/* Persisted scenarios */}
              {persistedScenarios.length > 0 && (
                <div className="border-t border-subtle">
                  <div className="px-3 py-1 text-[10px] text-faint uppercase tracking-wider">
                    Saved Scenarios
                  </div>
                  {persistedScenarios.map((s) => (
                    <div
                      key={s.id}
                      className={`flex items-center gap-2 px-3 py-1.5 hover:bg-surface-sunken group ${
                        activeSelection.type === "persisted" &&
                        activeSelection.id === s.id
                          ? "bg-blue-50 text-blue-700"
                          : "text-secondary"
                      }`}
                    >
                      <button
                        role="option"
                        aria-selected={
                          activeSelection.type === "persisted" &&
                          activeSelection.id === s.id
                        }
                        onClick={() => {
                          setActive({ type: "persisted", id: s.id });
                          setDropdownOpen(false);
                        }}
                        className="flex-1 text-left flex items-center gap-2"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                        {s.name}
                      </button>
                      {canManageScenarios && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete("persisted", s.id);
                          }}
                          className="sm:opacity-0 sm:group-hover:opacity-100 text-faint hover:text-red-500 transition-opacity"
                          title="Delete scenario"
                          aria-label="Delete scenario"
                        >
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Session scenarios */}
              {sessionScenarios.length > 0 && (
                <div className="border-t border-subtle">
                  <div className="px-3 py-1 text-[10px] text-faint uppercase tracking-wider">
                    Session Only (not saved)
                  </div>
                  {sessionScenarios.map((s) => (
                    <div
                      key={s.id}
                      className={`flex items-center gap-2 px-3 py-1.5 hover:bg-surface-sunken group ${
                        activeSelection.type === "session" &&
                        activeSelection.id === s.id
                          ? "bg-blue-50 text-blue-700"
                          : "text-secondary"
                      }`}
                    >
                      <button
                        role="option"
                        aria-selected={
                          activeSelection.type === "session" &&
                          activeSelection.id === s.id
                        }
                        onClick={() => {
                          setActive({ type: "session", id: s.id });
                          setDropdownOpen(false);
                        }}
                        className="flex-1 text-left flex items-center gap-2"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                        {s.name}
                        <span className="text-[10px] text-faint">
                          (session)
                        </span>
                      </button>
                      {canManageScenarios && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete("session", s.id);
                          }}
                          className="sm:opacity-0 sm:group-hover:opacity-100 text-faint hover:text-red-500 transition-opacity"
                          title="Delete scenario"
                          aria-label="Delete scenario"
                        >
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Create new */}
              <div className="border-t border-subtle p-2">
                {creating ? (
                  <div className="space-y-1.5">
                    <input
                      ref={inputRef}
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCreate();
                        if (e.key === "Escape") setCreating(null);
                      }}
                      placeholder="Scenario name..."
                      className="w-full border border-strong rounded px-2 py-1 text-xs bg-surface-primary text-primary"
                    />
                    <div className="flex gap-1">
                      <button
                        onClick={handleCreate}
                        className="flex-1 px-2 py-1.5 bg-blue-600 text-white rounded text-[10px] hover:bg-blue-700"
                      >
                        {creating === "persisted" ? "Save" : "Create Temp"}
                      </button>
                      <button
                        onClick={() => setCreating(null)}
                        className="px-2 py-1.5 text-muted text-[10px] hover:text-secondary"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    {canManageScenarios && (
                      <>
                        <button
                          onClick={() => setCreating("persisted")}
                          className="flex-1 text-center py-2 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          title="Create a scenario that persists across sessions"
                        >
                          + Saved
                        </button>
                        <button
                          onClick={() => setCreating("session")}
                          className="flex-1 text-center py-2 text-muted hover:bg-surface-elevated rounded transition-colors"
                          title="Create a quick what-if scenario (lost when you leave)"
                        >
                          + Quick
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="w-px h-4 bg-surface-strong" />

      {/* View mode toggle */}
      <div className="flex items-center gap-2">
        <span className="text-faint hidden sm:inline" id="view-mode-label">
          View:
        </span>
        <div
          className="flex bg-surface-elevated rounded-md p-0.5"
          role="tablist"
          aria-labelledby="view-mode-label"
        >
          <button
            role="tab"
            aria-selected={viewMode === "projected"}
            onClick={() => setViewMode("projected")}
            className={`px-3 py-1.5 rounded text-[11px] transition-colors ${
              viewMode === "projected"
                ? "bg-surface-primary text-primary shadow-sm"
                : "text-muted hover:text-secondary "
            }`}
          >
            Projected Year
          </button>
          <button
            role="tab"
            aria-selected={viewMode === "ytd"}
            onClick={() => setViewMode("ytd")}
            className={`px-3 py-1.5 rounded text-[11px] transition-colors ${
              viewMode === "ytd"
                ? "bg-surface-primary text-primary shadow-sm"
                : "text-muted hover:text-secondary "
            }`}
          >
            Actual YTD
          </button>
        </div>
      </div>
    </div>
  );
}
