"use client";

import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { TRPCClientError } from "@trpc/client";

export function LoadingCard({ title }: { title: string }) {
  return (
    <Card title={title}>
      <div className="animate-pulse space-y-2">
        <div className="bg-surface-strong h-8 w-1/2 rounded" />
        <div className="bg-surface-elevated h-4 w-3/4 rounded" />
      </div>
    </Card>
  );
}

/**
 * Categorize a tRPC error for the user-facing message.
 * Distinguishes:
 *   - 401 / UNAUTHORIZED → re-auth needed
 *   - 403 / FORBIDDEN → permission issue
 *   - 5xx / INTERNAL_SERVER_ERROR → server problem
 *   - default → generic
 */
function categorizeErrorMessage(error: unknown): string {
  if (error instanceof TRPCClientError) {
    const code = error.data?.code;
    if (code === "UNAUTHORIZED") {
      return "You're signed out. Refresh the page to sign in again.";
    }
    if (code === "FORBIDDEN") {
      return "You don't have permission to view this. Ask an admin to grant access.";
    }
    if (code === "INTERNAL_SERVER_ERROR") {
      return error.message || "The server hit an error. Please try again.";
    }
    return error.message || "Failed to load";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Failed to load";
}

export function ErrorCard({
  title,
  message,
  error,
}: {
  title: string;
  /** Plain string message — shown as-is. Pass either this OR `error`. */
  message?: string;
  /** Error object (typically a TRPCClientError) — message derived. */
  error?: unknown;
}) {
  const shown = error
    ? categorizeErrorMessage(error)
    : (message ?? "Failed to load");
  return (
    <Card title={title}>
      <p className="text-sm text-red-600">{shown}</p>
    </Card>
  );
}

/** Wrap a card/section in an error boundary with a fallback error card. */
export function CardBoundary({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <ErrorBoundary
      fallback={
        <ErrorCard title={title} message="This card encountered an error" />
      }
    >
      {children}
    </ErrorBoundary>
  );
}
