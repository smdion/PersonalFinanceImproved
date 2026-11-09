// @vitest-environment happy-dom
/**
 * settle (screen-mount.tsx) waits for a next/dynamic chunk however long it
 * takes to load, for a Suspense fallback and for a fetching query, and
 * fails, naming why, when the page never settles. On a busy host a chunk
 * can land after the page's text has held still: the screens pin then
 * reads its skeleton, or it lands while axe runs and the swapped heading
 * drops out of axe's heading-order count.
 */
import "../routers/setup-mocks";
import "./mocks";
import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import dynamic from "next/dynamic";
import { lazy, Suspense, useEffect, useState, type JSX } from "react";
import { screenQueryClients, settle } from "./screen-mount";

/** Longer than any quiet spell settle waits out on its own. */
const SLOW_CHUNK_MS = 1_500;

const SlowChart = dynamic(
  () =>
    new Promise<{ default: () => JSX.Element }>((resolve) =>
      setTimeout(
        () => resolve({ default: () => <h4>Loaded chart</h4> }),
        SLOW_CHUNK_MS,
      ),
    ),
  { loading: () => <p>Loading chart</p>, ssr: false },
);

describe("settle", () => {
  it("returns only after a slow chunk has loaded and rendered", async () => {
    const { container } = render(
      <section>
        <h2>Retirement</h2>
        <SlowChart />
      </section>,
    );
    await settle(container);
    expect(container.textContent).toBe("RetirementLoaded chart");
    cleanup();
  }, 10_000);

  it("waits while a Suspense fallback is shown", async () => {
    const Slow = lazy(
      () =>
        new Promise<{ default: () => JSX.Element }>((resolve) =>
          setTimeout(
            () => resolve({ default: () => <h4>Loaded table</h4> }),
            SLOW_CHUNK_MS,
          ),
        ),
    );
    const { container } = render(
      <Suspense fallback={<p>Loading table</p>}>
        <Slow />
      </Suspense>,
    );
    await settle(container);
    expect(container.textContent).toBe("Loaded table");
    cleanup();
  }, 10_000);

  it("waits until no query is fetching", async () => {
    const client = new QueryClient();
    screenQueryClients.add(client);
    try {
      const { container } = render(<p>Page</p>);
      void client.fetchQuery({
        queryKey: ["slow"],
        queryFn: () =>
          new Promise((resolve) => setTimeout(() => resolve(1), SLOW_CHUNK_MS)),
      });
      expect(client.isFetching()).toBe(1);
      await settle(container);
      expect(client.isFetching()).toBe(0);
      cleanup();
    } finally {
      screenQueryClients.delete(client);
    }
  }, 10_000);

  it("fails loudly when the page never settles", async () => {
    function Ticker() {
      const [n, setN] = useState(0);
      useEffect(() => {
        const t = setInterval(() => setN((x) => x + 1), 5);
        return () => clearInterval(t);
      }, []);
      return <p>{n}</p>;
    }
    const { container } = render(<Ticker />);
    await expect(settle(container, 500)).rejects.toThrow(
      /settle: the page didn't settle in 500 ms \(its text still changing\)/,
    );
    cleanup();
  }, 10_000);
});
