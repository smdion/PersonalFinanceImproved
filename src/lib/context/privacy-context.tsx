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

/**
 * Privacy mode (hide dollar amounts). `initialPrivacy` comes from the
 * PRIVACY_COOKIE read by the dashboard layout, so the first browser render
 * already agrees with the server render (which skipped prefetch — see
 * prefetchForPage).
 *
 * Toggling does not re-render the formatCurrency call sites by itself (they
 * read a module flag, not this context): DashboardShell keys its content on
 * `privacy`, so the open page remounts. The React Query cache survives, so
 * nothing refetches, but unsaved inline edits on that page are reset.
 */
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
