"use client";

import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";

export function DemoBanner({ profileName, isDemoOnly }: { profileName: string; isDemoOnly?: boolean }) {
  const router = useRouter();
  const utils = trpc.useUtils();

  return (
    <div className="bg-amber-600 text-white text-center py-1.5 px-4 text-sm flex items-center justify-center gap-3">
      <span className="font-medium">
        {isDemoOnly ? profileName : `Demo Mode — ${profileName}`}
      </span>
      <button
        onClick={async () => {
          if (isDemoOnly) {
            // In demo-only mode, go to profile chooser
            await utils.invalidate();
            router.push("/demo");
          } else {
            // In normal mode, exit demo and return to real data
            document.cookie = "demo_active_profile=;path=/;max-age=0";
            await utils.invalidate();
            router.push("/");
            router.refresh();
          }
        }}
        className="px-2 py-0.5 text-xs bg-amber-800 hover:bg-amber-900 rounded transition-colors"
      >
        {isDemoOnly ? "Switch Profile" : "Exit Demo"}
      </button>
    </div>
  );
}
