"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard-error]", error.digest ?? "no-digest", error.message);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <h2 className="text-xl font-semibold text-red-600">
        Something went wrong
      </h2>
      <p className="text-muted">
        {error.message || "An unexpected error occurred."}
      </p>
      {error.digest && (
        <p className="text-xs text-muted font-mono">Error ID: {error.digest}</p>
      )}
      <Button onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
