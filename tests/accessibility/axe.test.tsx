/**
 * Accessibility tests using axe-core.
 *
 * Renders key UI components into happy-dom and runs axe-core checks for ARIA /
 * accessibility violations.  These are lightweight smoke tests — they catch
 * missing labels, invalid roles, color-contrast markup issues, etc.
 *
 * Pages (v0.10.4 commit 4): every page the screens baseline mounts
 * (tests/baseline/screens.test.tsx), for its three households, mounted the
 * same way. Each page's violations, counted by rule in elements, must
 * equal `axe-baseline.json`, which only shrinks: a fix lowers its count in
 * the same commit; a new violation is fixed, not recorded. (The file has
 * eslint-suppressions.json's shape, for check:ratchets to hold once it is
 * at the merge base.) `color-contrast` stays off: happy-dom can't compute
 * it.
 *
 *   LEDGR_BASELINE_WRITE=1 pnpm test tests/accessibility/axe.test.tsx
 *
 * writes the file and prints it between `@@axe` and `@@end` lines (a run
 * on the test VM writes there, not here).
 */
// First: the SQLite harness's mocks and the baseline's (for the pages).
import "../routers/setup-mocks";
import "../baseline/mocks";
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ComponentType, ReactNode } from "react";
import { cleanup, render } from "@testing-library/react";
import * as axe from "axe-core";
import { HOUSEHOLDS } from "../baseline/households";
import { REGENERATE } from "../baseline/router-suite";
import {
  freezeScreenClock,
  mountPage,
  openHousehold,
  screenProviders,
  type ScreenHousehold,
} from "../baseline/screen-mount";
import { SCREEN_HOUSEHOLDS, SCREEN_ROUTES } from "../baseline/screen-routes";

import { Card, Metric, ProgressBar } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormError } from "@/components/ui/form-error";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { Toggle } from "@/components/ui/toggle";

// The pages' tRPC and Simulation seed, as the screens baseline has them.
vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("../baseline/screen-mount")).screenTrpc(
    (await import("../components/trpc-mock")).trpc,
  ),
}));
vi.mock("@/server/services/projection/projection-cache", async (orig) => ({
  ...(await orig<
    typeof import("@/server/services/projection/projection-cache")
  >()),
  generateSeed: () => 31,
}));

// ---------------------------------------------------------------------------
// Helper — run axe on a rendered container and return violations
// ---------------------------------------------------------------------------

async function getViolations(container: HTMLElement) {
  const results = await axe.run(
    container as axe.ElementContext,
    {
      rules: { "color-contrast": { enabled: false } },
    } as axe.RunOptions,
  );
  return results.violations;
}

function formatViolations(violations: axe.Result[]) {
  return violations
    .map(
      (v) =>
        `[${v.impact}] ${v.id}: ${v.help}\n` +
        v.nodes.map((n: { html: string }) => `  - ${n.html}`).join("\n"),
    )
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Positive control: every test below asserts "no violations", which an axe
// run that silently checked nothing (a DOM environment it can't inspect)
// would also satisfy.
describe("axe positive control", () => {
  it("reports known violations in a deliberately broken fragment", async () => {
    const { container } = render(
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- deliberately inaccessible fixture for axe to flag */}
        <img src="/x.png" />
        <button />
        <input type="text" />
        <div role="not-a-role">x</div>
      </div>,
    );
    const ids = (await getViolations(container)).map((v) => v.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "image-alt",
        "button-name",
        "label",
        "aria-roles",
      ]),
    );
  });
});

describe("Accessibility — axe-core", () => {
  it("Card renders without violations", async () => {
    const { container } = render(
      <Card title="Test Card" subtitle="A subtitle">
        <p>Card body content</p>
      </Card>,
    );
    const violations = await getViolations(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  it("Card with link renders without violations", async () => {
    const { container } = render(
      <Card href="/dashboard" title="Dashboard">
        <p>Go to dashboard</p>
      </Card>,
    );
    const violations = await getViolations(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  it("Collapsible Card renders without violations", async () => {
    const { container } = render(
      <Card title="Collapsible" isCollapsible isDefaultOpen={true}>
        <p>Expandable content</p>
      </Card>,
    );
    const violations = await getViolations(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  it("Metric renders without violations", async () => {
    const { container } = render(
      <Metric
        value="$12,345"
        label="Net Worth"
        trend={{ value: "+3.2%", isPositive: true }}
      />,
    );
    const violations = await getViolations(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  it("ProgressBar renders without violations", async () => {
    const { container } = render(
      <ProgressBar value={0.65} label="Savings Goal" />,
    );
    const violations = await getViolations(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  it("ProgressBar exposes an accessible progressbar with a name and value", async () => {
    const { getByRole } = render(
      <ProgressBar value={0.65} label="Savings Goal" />,
    );
    const bar = getByRole("progressbar", { name: "Savings Goal" });
    expect(bar).toHaveAttribute("aria-valuenow", "65");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("EmptyState renders without violations", async () => {
    const { container } = render(
      <EmptyState
        message="No accounts found"
        hint="Add your first account to get started."
      />,
    );
    const violations = await getViolations(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  it("FormError renders without violations", async () => {
    const { container } = render(
      <FormError message="Name is required" prefix="Validation error" />,
    );
    const violations = await getViolations(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  it("PageHeader renders without violations", async () => {
    const { container } = render(
      <PageHeader title="Budget" subtitle="Monthly spending overview">
        <button type="button">Export</button>
      </PageHeader>,
    );
    const violations = await getViolations(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  it("Toggle renders without violations", async () => {
    const { container } = render(
      <Toggle isChecked={false} onChange={() => {}} label="Include taxes" />,
    );
    const violations = await getViolations(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  it("Modal renders without violations", async () => {
    const { container } = render(
      <Modal labelledBy="axe-modal-title" className="p-5" onClose={() => {}}>
        <h2 id="axe-modal-title">Finalize 2026</h2>
        <button type="button">Cancel</button>
      </Modal>,
    );
    const violations = await getViolations(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  it("Toggle without label renders without violations", async () => {
    const { container } = render(
      <Toggle isChecked={true} onChange={() => {}} title="Dark mode" />,
    );
    const violations = await getViolations(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Pages: violations by rule, shrink-only (axe-baseline.json)
// ---------------------------------------------------------------------------

/** `<household>/<page>` → rule → elements, as eslint-suppressions.json. */
type AxeBaseline = Record<string, Record<string, { count: number }>>;

const AXE_BASELINE = path.join(__dirname, "axe-baseline.json");

function countsByRule(violations: axe.Result[]): AxeBaseline[string] {
  return Object.fromEntries(
    violations
      .map((v) => [v.id, { count: v.nodes.length }] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

describe("axe per page", () => {
  freezeScreenClock();
  const recorded = JSON.parse(
    fs.readFileSync(AXE_BASELINE, "utf8"),
  ) as AxeBaseline;
  const found: AxeBaseline = {};

  afterAll(() => {
    if (!REGENERATE) return;
    const sorted = Object.fromEntries(
      Object.entries(found).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    const text = `${JSON.stringify(sorted, null, 2)}\n`;
    fs.writeFileSync(AXE_BASELINE, text);
    console.log(`@@axe\n${text}@@end`);
  });

  it("has an entry only for a page it mounts", () => {
    const pages = new Set(
      SCREEN_HOUSEHOLDS.flatMap((key) =>
        SCREEN_ROUTES.map((r) => `${key}/${r.file}`),
      ),
    );
    expect(Object.keys(recorded).filter((k) => !pages.has(k))).toEqual([]);
  });

  describe.each(SCREEN_HOUSEHOLDS.map((key) => [key] as const))("%s", (key) => {
    let h: ScreenHousehold;
    let Providers: ComponentType<{ children: ReactNode }>;

    beforeAll(async () => {
      h = await openHousehold(HOUSEHOLDS.find((x) => x.key === key)!);
      Providers = await screenProviders();
    }, 120_000);
    afterAll(() => h.close());

    it.each(SCREEN_ROUTES.map((r) => [r.route, r] as const))(
      "%s",
      async (_route, r) => {
        const container = await mountPage(h, await r.load(), Providers);
        const violations = await getViolations(container);
        cleanup();
        const page = `${key}/${r.file}`;
        const counts = countsByRule(violations);
        if (Object.keys(counts).length > 0) found[page] = counts;
        if (REGENERATE) return;
        expect(
          counts,
          `${page}: a lower count is a fix (lower axe-baseline.json with it); a higher one is a new violation\n${formatViolations(violations)}`,
        ).toEqual(recorded[page] ?? {});
      },
      60_000,
    );
  });
});
