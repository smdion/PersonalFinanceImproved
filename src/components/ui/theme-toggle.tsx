"use client";

import { useTheme } from "@/lib/hooks/use-theme";

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
      <button
        onClick={() => setTheme(next)}
        className="p-1 text-faint hover:text-primary transition-colors"
        aria-label={`Theme: ${current.label}. Click to switch.`}
        title={`Theme: ${current.label}`}
      >
        <span className="text-sm">{current.icon}</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1 px-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setTheme(opt.value)}
          className={`flex-1 flex items-center justify-center gap-1 px-1.5 py-1 rounded text-[11px] transition-colors ${
            theme === opt.value
              ? "bg-surface-elevated text-white"
              : "text-faint hover:text-primary hover:bg-surface-primary"
          }`}
          aria-label={`${opt.label} theme`}
          aria-pressed={theme === opt.value}
          title={`${opt.label} theme`}
        >
          <span>{opt.icon}</span>
          <span>{opt.label}</span>
        </button>
      ))}
    </div>
  );
}
