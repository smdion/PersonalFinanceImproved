/**
 * A request refused for its demo profile (data.demoSessionEnded, 412) shows
 * the way back to the demo picker on every page instead of retrying and
 * shimmering forever. The real Providers run against a stubbed fetch.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Providers } from "@/app/providers";
import { trpc } from "@/lib/trpc";

const MESSAGE =
  "This demo profile needs to be set up again (Ledgr was updated). Choose a demo profile again to continue.";

function respond(status: number, data: Record<string, unknown>) {
  const body = [
    {
      error: {
        message: MESSAGE,
        code: -32012,
        data: { code: "PRECONDITION_FAILED", httpStatus: status, ...data },
      },
    },
  ];
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function Page() {
  const versions = trpc.version.list.useQuery();
  if (versions.isLoading) return <p>Loading the page</p>;
  if (versions.error) return <p>The page failed</p>;
  return <p>The page</p>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Providers on a refused demo profile", () => {
  it("replaces the page with the message and a link to the demo picker, without retrying", async () => {
    const fetchMock = respond(412, { demoSessionEnded: true });
    render(
      <Providers>
        <Page />
      </Providers>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(MESSAGE);
    expect(
      screen.getByRole("link", { name: "Choose a demo profile" }),
    ).toHaveAttribute("href", "/demo");
    expect(screen.queryByText("Loading the page")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("any other refusal stays the page's own error", async () => {
    respond(412, { demoSessionEnded: false });
    render(
      <Providers>
        <Page />
      </Providers>,
    );
    // Retries back off for seconds; the page is still its own meanwhile.
    expect(await screen.findByText("Loading the page")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
