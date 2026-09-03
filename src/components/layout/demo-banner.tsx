"use client";

import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";

export function DemoBanner({
  profileName,
  isDemoOnly,
}: {
  profileName: string;
  isDemoOnly?: boolean;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();

  return (
    <div className="flex items-center justify-center gap-3 bg-amber-600 px-4 py-1.5 text-center text-sm text-white">
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
        className="rounded bg-amber-800 px-2 py-0.5 text-xs transition-colors hover:bg-amber-900"
      >
        {isDemoOnly ? "Switch Profile" : "Exit Demo"}
      </button>
    </div>
  );
}
