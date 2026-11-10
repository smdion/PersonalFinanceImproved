"use client";

import { Eye, EyeOff } from "lucide-react";
import { usePrivacy } from "@/lib/context/privacy-context";
import { UtilityButton } from "@/components/ui/utility-button";

export function PrivacyToggle({ compact = false }: { compact?: boolean }) {
  const { privacy, setPrivacy } = usePrivacy();
  const Icon = privacy ? EyeOff : Eye;
  const label = privacy ? "Show amounts" : "Hide amounts";

  if (compact) {
    // Icon-only toggle for utility bar / collapsed sidebar
    return (
      <UtilityButton
        shape="icon"
        onClick={() => setPrivacy(!privacy)}
        pressed={privacy}
        ariaLabel={label}
        title={label}
      >
        <Icon className="h-3.5 w-3.5" />
      </UtilityButton>
    );
  }

  return (
    <div className="flex items-center gap-1 px-2">
      <UtilityButton
        shape="pill"
        onClick={() => setPrivacy(!privacy)}
        pressed={privacy}
        ariaLabel={label}
        title={label}
      >
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </UtilityButton>
    </div>
  );
}
