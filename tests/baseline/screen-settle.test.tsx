// @vitest-environment happy-dom
/**
 * settle (screen-mount.tsx) waits for a next/dynamic chunk however long it
 * takes to load. On a busy host one can land after the page's text has held
 * still: the screens pin then reads its skeleton, or it lands while axe runs
 * and the swapped heading drops out of axe's heading-order count.
 */
import "../routers/setup-mocks";
import "./mocks";
import { describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import dynamic from "next/dynamic";
import type { JSX } from "react";
import { settle } from "./screen-mount";

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
});
