"use client";

import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { ErrorBoundary } from "@/components/ui/error-boundary";

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

export function ErrorCard({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <Card title={title}>
      <p className="text-sm text-red-500">{message}</p>
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
