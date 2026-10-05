"use client";

import { Eye, EyeOff } from "lucide-react";
import { usePrivacy } from "@/lib/context/privacy-context";

export function PrivacyToggle({ compact = false }: { compact?: boolean }) {
  const { privacy, setPrivacy } = usePrivacy();
  const Icon = privacy ? EyeOff : Eye;
  const label = privacy ? "Show amounts" : "Hide amounts";

  if (compact) {
    // Icon-only toggle for utility bar / collapsed sidebar
    return (
      <button
        onClick={() => setPrivacy(!privacy)}
        className="text-faint hover:text-primary p-1 transition-colors"
        aria-label={label}
        aria-pressed={privacy}
        title={label}
      >
        <Icon className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1 px-2">
      <button
        onClick={() => setPrivacy(!privacy)}
        className={`text-label flex flex-1 items-center justify-center gap-1 rounded px-1.5 py-1 transition-colors ${
          privacy
            ? "bg-blue-600 text-white"
            : "text-faint hover:text-primary hover:bg-surface-primary"
        }`}
        aria-label={label}
        aria-pressed={privacy}
        title={label}
      >
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </button>
    </div>
  );
}
