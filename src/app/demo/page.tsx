"use client";

/** Demo mode entry page for selecting a demo profile and launching the app without credentials. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";

export default function DemoPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data } = trpc.demo.listProfiles.useQuery();
  const profiles = data?.profiles;
  const isDemoOnly = data?.isDemoOnly ?? false;
  const activateMut = trpc.demo.activateProfile.useMutation({
    onSuccess: async () => {
      // Cookie is set server-side (HttpOnly) by the mutation — just invalidate and redirect
      await utils.invalidate();
      router.push("/");
    },
  });
  const deactivateMut = trpc.demo.deactivateDemo.useMutation();
  const [activating, setActivating] = useState<string | null>(null);

  return (
    <div className="bg-surface-primary text-primary min-h-screen p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-2 text-2xl font-bold">
          {isDemoOnly ? "Welcome to Ledgr" : "Demo Mode"}
        </h1>
        <p className="text-faint mb-8">
          {isDemoOnly
            ? "Choose a financial profile to explore the dashboard. Each profile showcases different financial scenarios."
            : "Explore the app with preset financial profiles. Your real data is never touched — each profile runs in an isolated environment."}
        </p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {(profiles ?? []).map((p) => (
            <div
              key={p.slug}
              className="bg-surface-primary rounded-lg border p-5 transition-colors hover:border-blue-500"
            >
              <h2 className="text-primary mb-1 text-lg font-semibold">
                {p.name}
              </h2>
              <p className="text-faint mb-3 text-sm">{p.description}</p>
              <div className="text-muted mb-4 flex gap-4 text-xs">
                <span>
                  Income:{" "}
                  <span className="text-faint">{p.keyStats.income}</span>
                </span>
                <span>
                  Portfolio:{" "}
                  <span className="text-faint">{p.keyStats.portfolioSize}</span>
                </span>
                <span>
                  Savings:{" "}
                  <span className="text-faint">{p.keyStats.savingsRate}</span>
                </span>
              </div>
              <button
                onClick={() => {
                  setActivating(p.slug);
                  activateMut.mutate({ slug: p.slug });
                }}
                disabled={activateMut.isPending}
                className="w-full rounded bg-blue-600 px-3 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {activating === p.slug && activateMut.isPending
                  ? "Setting up..."
                  : "Launch"}
              </button>
            </div>
          ))}
        </div>

        {/* Exit demo link — hidden in demo-only mode */}
        {!isDemoOnly && (
          <div className="mt-8 text-center">
            <button
              onClick={async () => {
                await deactivateMut.mutateAsync();
                await utils.invalidate();
                router.push("/");
              }}
              className="text-muted hover:text-faint text-sm"
            >
              Exit demo mode and return to real data
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
