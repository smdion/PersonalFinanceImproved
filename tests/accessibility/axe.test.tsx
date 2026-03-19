/**
 * Accessibility tests using axe-core.
 *
 * Renders key UI components into jsdom and runs axe-core checks for ARIA /
 * accessibility violations.  These are lightweight smoke tests — they catch
 * missing labels, invalid roles, color-contrast markup issues, etc.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import * as axe from "axe-core";

import { Card, Metric, ProgressBar } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormError, FormErrorBlock } from "@/components/ui/form-error";
import { PageHeader } from "@/components/ui/page-header";
import { Toggle } from "@/components/ui/toggle";

// ---------------------------------------------------------------------------
// Helper — run axe on a rendered container and return violations
// ---------------------------------------------------------------------------

async function getViolations(container: HTMLElement) {
  const results = await axe.run(container as axe.ElementContext, {
    rules: { "color-contrast": { enabled: false } },
  } as axe.RunOptions);
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
      <Card title="Collapsible" collapsible defaultOpen={true}>
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
        trend={{ value: "+3.2%", positive: true }}
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

  it("FormErrorBlock renders without violations", async () => {
    const { container } = render(
      <FormErrorBlock message="Failed to save changes" />,
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
      <Toggle
        checked={false}
        onChange={() => {}}
        label="Include taxes"
      />,
    );
    const violations = await getViolations(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  it("Toggle without label renders without violations", async () => {
    const { container } = render(
      <Toggle checked={true} onChange={() => {}} title="Dark mode" />,
    );
    const violations = await getViolations(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
