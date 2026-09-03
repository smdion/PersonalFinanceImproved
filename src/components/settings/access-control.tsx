"use client";

/**
 * Consolidated "Access Control" settings shell — Auth (Authentik OIDC
 * connection setup) and RBAC (mapping Authentik groups to app permissions)
 * used to be 2 separate admin-only Settings tabs. They're sequential steps
 * in the same setup flow (connect OIDC, then map its groups to
 * permissions), so this shell gives them one left-column sub-nav instead.
 * Unlike Tax Data's shell, there's no cross-cutting control to share
 * between them (no year axis here) — this is just navigation, so both
 * children render unmodified.
 */
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { SK_SETTINGS_ACCESS_CONTROL_SECTION } from "@/lib/constants/settings-keys";
import { AuthSettings } from "@/components/settings/auth-settings";
import { RbacGroupsSettings } from "@/components/settings/rbac-groups";

const SECTIONS = [
  { key: "auth", label: "Authentik" },
  { key: "rbac", label: "RBAC Groups" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

/** Old top-level Settings tab keys (pre-consolidation) — see the matching
 *  OLD_TAX_TAB_KEYS in tax-data.tsx for why this lives next to the shell
 *  instead of in settings/page.tsx. */
export const OLD_ACCESS_TAB_KEYS: readonly string[] = ["auth", "rbac"];

export function AccessControlSettings() {
  const [section, setSection] = usePersistedSetting<SectionKey>(
    SK_SETTINGS_ACCESS_CONTROL_SECTION,
    "auth",
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
      <nav className="flex md:flex-col gap-1 overflow-x-auto">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={`px-3 py-2 text-sm text-left rounded-md whitespace-nowrap transition-colors ${
              section === s.key
                ? "bg-blue-600 text-white"
                : "text-secondary hover:bg-surface-elevated"
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div>
        {section === "auth" && <AuthSettings />}
        {section === "rbac" && <RbacGroupsSettings />}
      </div>
    </div>
  );
}
