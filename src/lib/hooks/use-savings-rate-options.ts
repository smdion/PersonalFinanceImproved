"use client";

/**
 * What the household savings rate counts — employer match and Portfolio
 * money — shared by every surface that shows a rate or a contribution total
 * (Financial Checkup, Contributions page and card, Paycheck snapshot,
 * Retirement card), so flipping either switch anywhere changes them all.
 *
 * Admins save the choice to the household's settings; anyone else keeps it
 * in this browser (a viewer can't write settings, and a view switch must
 * still work for them). Either way every component on the page updates at
 * once through the small store below.
 */
import { useCallback, useSyncExternalStore } from "react";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useUser, isAdmin } from "@/lib/context/user-context";
import {
  SK_SAVINGS_RATE_INCLUDE_PORTFOLIO,
  SK_SAVINGS_RATE_MATCH,
} from "@/lib/constants/settings-keys";

/** "auto": leave the match out at or above the high-income threshold. */
type MatchChoice = "auto" | "include" | "exclude";

type Choices = { match: MatchChoice | null; portfolio: boolean | null };

const STORAGE_KEY = "ledgr-savings-rate-options";
const EMPTY: Choices = { match: null, portfolio: null };
let current: Choices = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function load(): Choices {
  if (!loaded && typeof window !== "undefined") {
    loaded = true;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) current = { ...EMPTY, ...(JSON.parse(stored) as Choices) };
    } catch {
      // unavailable or invalid — keep the defaults
    }
  }
  return current;
}

function update(next: Partial<Choices>, remember: boolean) {
  current = { ...load(), ...next };
  if (remember) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      // not persisted in this browser; the session still updates
    }
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSavingsRateOptions(highIncome: boolean): {
  excludeMatch: boolean;
  includePortfolio: boolean;
  toggleMatch: () => void;
  togglePortfolio: () => void;
} {
  const canSave = isAdmin(useUser());
  const [savedMatch, setSavedMatch] = usePersistedSetting<MatchChoice>(
    SK_SAVINGS_RATE_MATCH,
    "auto",
  );
  const [savedPortfolio, setSavedPortfolio] = usePersistedSetting<boolean>(
    SK_SAVINGS_RATE_INCLUDE_PORTFOLIO,
    true,
  );
  const choices = useSyncExternalStore(subscribe, load, () => EMPTY);
  // A missing or unreadable setting means the default.
  const match = choices.match ?? savedMatch ?? "auto";
  const includePortfolio = choices.portfolio ?? savedPortfolio ?? true;
  const excludeMatch = match === "auto" ? highIncome : match === "exclude";

  const toggleMatch = useCallback(() => {
    const next: MatchChoice = excludeMatch ? "include" : "exclude";
    // The store updates every component now; the setting (admins) persists it.
    update({ match: next }, !canSave);
    if (canSave) setSavedMatch(next);
  }, [excludeMatch, canSave, setSavedMatch]);

  const togglePortfolio = useCallback(() => {
    const next = !includePortfolio;
    update({ portfolio: next }, !canSave);
    if (canSave) setSavedPortfolio(next);
  }, [includePortfolio, canSave, setSavedPortfolio]);

  return { excludeMatch, includePortfolio, toggleMatch, togglePortfolio };
}
