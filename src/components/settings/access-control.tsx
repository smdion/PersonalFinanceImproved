"use client";

/**
 * "Access Control" settings shell: a sub-nav over Auth (Authentik OIDC setup) and RBAC (mapping
 * Authentik groups to permissions), the two steps of one setup flow. Navigation only.
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
 *  instead of in settings/settings-content.tsx. */
export const OLD_ACCESS_TAB_KEYS: readonly string[] = ["auth", "rbac"];

export function AccessControlSettings() {
  const [section, setSection] = usePersistedSetting<SectionKey>(
    SK_SETTINGS_ACCESS_CONTROL_SECTION,
    "auth",
  );

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[200px_1fr]">
      <nav className="flex gap-1 overflow-x-auto md:flex-col">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={`rounded-md px-3 py-2 text-left text-sm whitespace-nowrap transition-colors ${
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
