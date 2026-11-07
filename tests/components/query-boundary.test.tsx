/**
 * QueryBoundary: a page's state before its data. Loading shows the page's
 * own skeleton unchanged, with a "still loading" line and Retry after 20 s;
 * a failure shows its message and Retry instead of a skeleton for good; a
 * disabled query isn't pending, so the page renders what it does today.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  QueryBoundary,
  SLOW_LOAD_MS,
  queryPending,
  type BoundaryQuery,
} from "@/components/ui/query-boundary";
import { CardQueryBoundary, LoadingCard } from "@/components/dashboard/utils";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Page({
  load,
  enabled = true,
}: {
  load: () => Promise<string>;
  enabled?: boolean;
}) {
  const query = useQuery({
    queryKey: ["boundary-test"],
    queryFn: load,
    enabled,
    retry: false,
  });
  if (queryPending(query))
    return (
      <QueryBoundary
        query={query}
        what="the figures"
        fallback={<p>skeleton</p>}
      />
    );
  return <p>{query.data ?? "nothing yet"}</p>;
}

function renderPage(load: () => Promise<string>, enabled?: boolean) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <Page load={load} enabled={enabled} />
    </QueryClientProvider>,
  );
}

const loading = (over: Partial<BoundaryQuery> = {}): BoundaryQuery => ({
  error: null,
  isLoading: true,
  isFetching: true,
  refetch: vi.fn(),
  ...over,
});

describe("QueryBoundary", () => {
  it("a loaded query renders the page", async () => {
    renderPage(async () => "the figures");
    expect(screen.getByText("skeleton")).toBeInTheDocument();
    expect(await screen.findByText("the figures")).toBeInTheDocument();
    expect(screen.queryByText("skeleton")).toBeNull();
  });

  it("a disabled query isn't pending: the page renders today's branch", () => {
    const load = vi.fn(async () => "never");
    renderPage(load, false);
    expect(screen.getByText("nothing yet")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("skeleton")).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("a failed query shows its message and a Retry that refetches", async () => {
    let fail = true;
    const load = vi.fn(async () => {
      if (fail) throw new Error("the server is down");
      return "the figures";
    });
    renderPage(load);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Failed to load the figures: the server is down",
    );
    expect(screen.queryByText("skeleton")).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("the figures")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("an error with no message says only what failed", () => {
    render(
      <QueryBoundary
        query={loading({ error: true, isLoading: false, isFetching: false })}
        fallback={<p>skeleton</p>}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /^Failed to loadRetry$/,
    );
  });

  it("several queries: the first failure shows, and Retry refetches each failed one", () => {
    const ok = loading({ isLoading: false, isFetching: false });
    const a = loading({
      error: new Error("a broke"),
      isLoading: false,
      isFetching: false,
    });
    const b = loading({
      error: new Error("b broke"),
      isLoading: false,
      isFetching: false,
    });
    render(<QueryBoundary query={[ok, a, b]} fallback={<p>skeleton</p>} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Failed to load: a broke",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(a.refetch).toHaveBeenCalledTimes(1);
    expect(b.refetch).toHaveBeenCalledTimes(1);
    expect(ok.refetch).not.toHaveBeenCalled();
  });

  it("a refused demo profile shows its message and no Retry", () => {
    const error = Object.assign(new Error("Choose a demo profile again."), {
      data: { demoSessionEnded: true },
    });
    render(
      <QueryBoundary
        query={loading({ error, isLoading: false, isFetching: false })}
        fallback={<p>skeleton</p>}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose a demo profile again.",
    );
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("a slow load keeps the skeleton unchanged until 20 s, then adds the line, without a Retry", () => {
    vi.useFakeTimers();
    const query = loading();
    const { container } = render(
      <QueryBoundary query={query} fallback={<p>skeleton</p>} />,
    );
    expect(container.innerHTML).toBe("<p>skeleton</p>");
    act(() => vi.advanceTimersByTime(SLOW_LOAD_MS - 1));
    expect(container.innerHTML).toBe("<p>skeleton</p>");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toHaveTextContent("Still loading…");
    expect(screen.getByText("skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(query.refetch).not.toHaveBeenCalled();
  });

  it("while a failed query is fetched again, Retry waits and says so", () => {
    render(
      <QueryBoundary
        query={loading({ error: new Error("x"), isLoading: false })}
        fallback={<p>skeleton</p>}
      />,
    );
    expect(screen.getByRole("button", { name: "Retrying…" })).toBeDisabled();
  });

  it("a service failure shows the sentence the server wrote for it", () => {
    const error = Object.assign(new Error("ECONNRESET at budget-api.ts"), {
      data: { userMessage: "YNAB didn't answer. Nothing was changed." },
    });
    render(
      <QueryBoundary
        query={loading({ error, isLoading: false, isFetching: false })}
        what="budget"
        fallback={<p>skeleton</p>}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Failed to load budget: YNAB didn't answer. Nothing was changed.",
    );
  });

  it("a card loads with today's LoadingCard markup, and fails inside the card", () => {
    const { container: today } = render(<LoadingCard title="Net Worth" />);
    const before = today.innerHTML;
    cleanup();
    const { container, rerender } = render(
      <CardQueryBoundary title="Net Worth" query={loading()} />,
    );
    expect(container.innerHTML).toBe(before);
    rerender(
      <CardQueryBoundary
        title="Net Worth"
        query={loading({ error: new Error("x"), isLoading: false })}
      />,
    );
    expect(screen.getByText("Net Worth")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load: x");
  });
});
