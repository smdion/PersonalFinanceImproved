"use client";

import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import {
  QueryBoundary,
  type QueryBoundaryProps,
} from "@/components/ui/query-boundary";

export { queryPending } from "@/components/ui/query-boundary";

function CardPulse() {
  return (
    <div className="animate-pulse space-y-2">
      <div className="bg-surface-strong h-8 w-1/2 rounded" />
      <div className="bg-surface-elevated h-4 w-3/4 rounded" />
    </div>
  );
}

export function LoadingCard({ title }: { title: string }) {
  return (
    <Card title={title}>
      <CardPulse />
    </Card>
  );
}

/** A card while its queries load or after one fails (QueryBoundary in the
 *  card's frame): the pulse, or the failure's message and Retry. */
export function CardQueryBoundary({
  title,
  query,
}: {
  title: string;
  query: QueryBoundaryProps["query"];
}) {
  return (
    <QueryBoundary
      query={query}
      what={title}
      fallback={<CardPulse />}
      frame={(body) => <Card title={title}>{body}</Card>}
    />
  );
}

function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <Card title={title}>
      <p className="text-sm text-red-600">{message}</p>
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
