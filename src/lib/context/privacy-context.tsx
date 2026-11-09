"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { PRIVACY_COOKIE, setPrivacyMode } from "@/lib/utils/format";
import { startPrivacyTextGuard } from "@/lib/privacy-text-guard";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

type PrivacyContextValue = {
  privacy: boolean;
  setPrivacy: (on: boolean) => void;
};

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

/** Privacy mode (hide dollar amounts), initialized from PRIVACY_COOKIE so the first render
 *  matches the server's. formatCurrency reads a module flag, so toggling remounts the page
 *  (DashboardShell keys on `privacy`): no refetch, but unsaved inline edits reset. */
export function PrivacyProvider({
  initialPrivacy,
  children,
}: {
  initialPrivacy: boolean;
  children: React.ReactNode;
}) {
  const [privacy, setPrivacyState] = useState(initialPrivacy);

  // Set during render, before any child formats an amount. Browser only —
  // on the server the format module is shared across requests.
  if (typeof window !== "undefined") setPrivacyMode(privacy);

  // Text the format helpers never see (typed names, milestone labels,
  // server sentences) is masked on the page while privacy is on.
  useEffect(() => (privacy ? startPrivacyTextGuard() : undefined), [privacy]);

  const setPrivacy = useCallback((on: boolean) => {
    document.cookie = on
      ? `${PRIVACY_COOKIE}=1;path=/;max-age=${ONE_YEAR_SECONDS};samesite=lax`
      : `${PRIVACY_COOKIE}=;path=/;max-age=0;samesite=lax`;
    setPrivacyMode(on);
    setPrivacyState(on);
  }, []);

  return (
    <PrivacyContext.Provider value={{ privacy, setPrivacy }}>
      {children}
    </PrivacyContext.Provider>
  );
}

export function usePrivacy(): PrivacyContextValue {
  const ctx = useContext(PrivacyContext);
  if (!ctx) throw new Error("usePrivacy must be used within PrivacyProvider");
  return ctx;
}
