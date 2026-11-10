"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { demoSessionEndedMessage } from "@/lib/utils/demo-session";
import { serverSentence } from "@/lib/utils/mutation-error";

/** How long a load runs before the "still loading" line shows. */
export const SLOW_LOAD_MS = 20_000;

/**
 * What the boundary reads from a query: a tRPC query result, or a hook that
 * combines several queries and reports the same fields.
 */
export type BoundaryQuery = {
  error: unknown;
  isLoading: boolean;
  /** A failed query being fetched again: Retry waits. */
  isFetching?: boolean;
  refetch: () => unknown;
};

/** One query, or a list of queries and lists (a hook's gate queries). */
type Queries =
  BoundaryQuery | readonly (BoundaryQuery | readonly BoundaryQuery[])[];

export type QueryBoundaryProps = {
  /** One query, or every query the content waits on. */
  query: Queries;
  /** Today's loading look, shown unchanged while loading. */
  fallback: ReactNode;
  /** What failed, for "Couldn't load <what>. Try again." */
  what?: string;
  /** Wraps the state's body, such as a card with its title. */
  frame?: (body: ReactNode) => ReactNode;
};

const listOf = (query: Queries): readonly BoundaryQuery[] =>
  "isLoading" in query
    ? [query]
    : query.flatMap((q) => ("isLoading" in q ? [q] : q));

/**
 * True while any query is loading or has failed, so the page shows the
 * boundary instead of its content. A disabled query is neither: the page
 * renders what it renders without the data.
 */
export function queryPending(query: Queries): boolean {
  return listOf(query).some((q) => q.isLoading || Boolean(q.error));
}

/** A failed load in words: the server's own sentence when it
 *  wrote one, else "Couldn't load <what>. Try again." */
function loadFailureText(error: unknown, what: string | undefined) {
  return (
    serverSentence(error) ??
    `Couldn't load ${what ?? "this section"}. Try again.`
  );
}

/** Logs a failed load's raw error to the browser console once (the screen
 *  shows only the rule's sentence; UI code never imports the server log). */
function useLogLoadFailure(error: unknown, what: string | undefined) {
  useEffect(() => {
    if (!error) return;
    console.warn("load_failed", what ?? null, error);
  }, [error, what]);
}

function StillLoading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!slow) return null;
  return (
    <p role="status" className="text-muted mt-2 text-sm">
      Still loading…
    </p>
  );
}

/** A page's state before its data, rendered while `queryPending` says so:
 *  the skeleton (a "still loading" line after 20 s), or the failure and a
 *  Retry. A refused demo profile isn't retried (Providers swap the page). */
export function QueryBoundary({
  query,
  fallback,
  what,
  frame = (body) => body,
}: QueryBoundaryProps) {
  const queries = listOf(query);
  const failed = queries.filter((q) => Boolean(q.error));
  const [first] = failed;
  useLogLoadFailure(first?.error, what);
  if (first) {
    const ended = demoSessionEndedMessage(first.error);
    const retrying = failed.some((q) => q.isFetching);
    return frame(
      <div role="alert" className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-red-600">
          {ended ?? loadFailureText(first.error, what)}
        </p>
        {!ended && (
          <Button
            size="sm"
            variant="secondary"
            disabled={retrying}
            onClick={() => failed.forEach((q) => void q.refetch())}
          >
            {retrying ? "Retrying…" : "Retry"}
          </Button>
        )}
      </div>,
    );
  }
  return frame(
    <>
      {fallback}
      <StillLoading />
    </>,
  );
}
