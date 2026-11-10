"use client";

import { useTheme } from "@/lib/hooks/use-theme";
import { UtilityButton } from "@/components/ui/utility-button";

const options = [
  { value: "light" as const, label: "Light", icon: "\u2600" },
  { value: "dark" as const, label: "Dark", icon: "\u263E" },
  { value: "system" as const, label: "System", icon: "\u2699" },
] as const;

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();

  if (compact) {
    // Icon-only toggle for utility bar / collapsed sidebar
    const next =
      theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    const current = options.find((o) => o.value === theme)!;
    return (
      <UtilityButton
        shape="icon"
        onClick={() => setTheme(next)}
        ariaLabel={`Theme: ${current.label}. Click to switch.`}
        title={`Theme: ${current.label}`}
      >
        <span className="text-sm">{current.icon}</span>
      </UtilityButton>
    );
  }

  return (
    <div className="flex items-center gap-1 px-2">
      {options.map((opt) => (
        <UtilityButton
          key={opt.value}
          shape="pill"
          onClick={() => setTheme(opt.value)}
          pressed={theme === opt.value}
          ariaLabel={`${opt.label} theme`}
          title={`${opt.label} theme`}
        >
          <span>{opt.icon}</span>
          <span>{opt.label}</span>
        </UtilityButton>
      ))}
    </div>
  );
}
