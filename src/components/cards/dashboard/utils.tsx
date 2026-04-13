"use client";

import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { TRPCClientError } from "@trpc/client";

export function LoadingCard({ title }: { title: string }) {
  return (
    <Card title={title}>
      <div className="animate-pulse space-y-2">
        <div className="h-8 bg-surface-strong rounded w-1/2" />
        <div className="h-4 bg-surface-elevated rounded w-3/4" />
      </div>
    </Card>
  );
}

/**
 * Categorize a tRPC error for the user-facing message + retry decision
 * (v0.5 expert-review M28). Distinguishes:
 *   - 401 / UNAUTHORIZED → re-auth needed (retry won't help)
 *   - 403 / FORBIDDEN → permission issue (retry won't help)
 *   - 5xx / INTERNAL_SERVER_ERROR → server problem (retry might)
 *   - default → generic (retry might)
 */
function categorizeErrorMessage(error: unknown): {
  message: string;
  canRetry: boolean;
} {
  if (error instanceof TRPCClientError) {
    const code = error.data?.code;
    if (code === "UNAUTHORIZED") {
      return {
        message: "You're signed out. Refresh the page to sign in again.",
        canRetry: false,
      };
    }
    if (code === "FORBIDDEN") {
      return {
        message:
          "You don't have permission to view this. Ask an admin to grant access.",
        canRetry: false,
      };
    }
    if (code === "INTERNAL_SERVER_ERROR") {
      return {
        message: error.message || "The server hit an error. Please try again.",
        canRetry: true,
      };
    }
    return {
      message: error.message || "Failed to load",
      canRetry: true,
    };
  }
  if (error instanceof Error) {
    return { message: error.message, canRetry: true };
  }
  return { message: "Failed to load", canRetry: true };
}

export function ErrorCard({
  title,
  message,
  error,
  onRetry,
}: {
  title: string;
  /** Plain string message — shown as-is. Pass either this OR `error`. */
  message?: string;
  /** Error object (typically a TRPCClientError) — message + retry-eligibility derived. */
  error?: unknown;
  /** Optional retry callback. If provided AND the error is retryable, a Retry button renders. */
  onRetry?: () => void;
}) {
  const categorized = error
    ? categorizeErrorMessage(error)
    : { message: message ?? "Failed to load", canRetry: true };
  return (
    <Card title={title}>
      <p className="text-sm text-red-600">{categorized.message}</p>
      {onRetry && categorized.canRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 text-xs text-blue-600 hover:text-blue-700 underline"
        >
          Try again
        </button>
      )}
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
