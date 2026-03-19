"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "ledgr-theme";

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return (localStorage.getItem(STORAGE_KEY) as Theme) || "light";
}

function getResolvedTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: Theme) {
  const resolved = getResolvedTheme(theme);
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

type Listener = () => void;
let current: Theme = typeof window !== "undefined" ? getStoredTheme() : "light";
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Theme {
  return current;
}

function getServerSnapshot(): Theme {
  return "light";
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Apply on mount and when theme changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Listen for system preference changes when in system mode
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((newTheme: Theme) => {
    current = newTheme;
    localStorage.setItem(STORAGE_KEY, newTheme);
    applyTheme(newTheme);
    emit();
  }, []);

  return {
    theme,
    resolvedTheme: getResolvedTheme(theme),
    setTheme,
  };
}
