import Link from "next/link";
import {
  settingsHref,
  settingsLocationLabel,
  type SettingsSectionsByTab,
} from "@/lib/config/settings-sections";

export const LINK_CLASS = "text-blue-600 hover:underline";

/** A link that opens a Settings tab/section, labelled with its location
 *  ("Settings → Integrations → SimpleFIN") unless given its own text. */
export function SettingsLink<T extends keyof SettingsSectionsByTab>({
  tab,
  section,
  className = LINK_CLASS,
  children,
}: {
  tab: T;
  section?: SettingsSectionsByTab[T];
  /** Inside a coloured notice, pass "underline" so the link keeps the notice's colour. */
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Link href={settingsHref(tab, section)} className={className}>
      {children ?? settingsLocationLabel(tab, section)}
    </Link>
  );
}
