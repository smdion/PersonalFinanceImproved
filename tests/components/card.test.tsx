import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Card, Metric, ProgressBar } from "@/components/ui/card";

// ── Card ──────────────────────────────────────────────────────────

describe("Card", () => {
  // --- Plain variant ---
  it("renders children", () => {
    render(<Card>Hello world</Card>);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("renders title when provided", () => {
    render(<Card title="My Title">Content</Card>);
    expect(screen.getByText("My Title")).toBeInTheDocument();
  });

  it("renders subtitle when provided", () => {
    render(
      <Card title="Title" subtitle="Sub">
        Content
      </Card>,
    );
    expect(screen.getByText("Sub")).toBeInTheDocument();
  });

  it("renders as a div when no href", () => {
    const { container } = render(<Card>Plain</Card>);
    expect(container.querySelector("a")).toBeNull();
  });

  it("applies custom className", () => {
    const { container } = render(<Card className="custom-class">X</Card>);
    expect(
      container.firstElementChild?.classList.contains("custom-class"),
    ).toBe(true);
  });

  // --- Linked variant ---
  it("wraps in a link when href is provided", () => {
    render(<Card href="/budget">Go</Card>);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/budget");
  });

  it("link variant still renders title and children", () => {
    render(
      <Card href="/savings" title="Savings">
        $5,000
      </Card>,
    );
    expect(screen.getByText("Savings")).toBeInTheDocument();
    expect(screen.getByText("$5,000")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/savings");
  });

  // --- Collapsible variant ---
  it("supports collapsible toggle", () => {
    render(
      <Card title="Toggle" collapsible defaultOpen={true}>
        <span>Body</span>
      </Card>,
    );
    expect(screen.getByText("Body")).toBeInTheDocument();

    // Click the header to collapse
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("Body")).toBeNull();

    // Click again to expand
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("starts collapsed when defaultOpen is false", () => {
    render(
      <Card title="Closed" collapsible defaultOpen={false}>
        <span>Hidden</span>
      </Card>,
    );
    expect(screen.queryByText("Hidden")).toBeNull();
  });

  it("has correct aria-expanded when open", () => {
    render(
      <Card title="A11y" collapsible defaultOpen={true}>
        <span>Content</span>
      </Card>,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
  });

  it("has correct aria-expanded when collapsed", () => {
    render(
      <Card title="A11y" collapsible defaultOpen={false}>
        <span>Content</span>
      </Card>,
    );
    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("toggles via keyboard Enter key", () => {
    render(
      <Card title="Keyboard" collapsible defaultOpen={true}>
        <span>Visible</span>
      </Card>,
    );
    expect(screen.getByText("Visible")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    expect(screen.queryByText("Visible")).toBeNull();

    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    expect(screen.getByText("Visible")).toBeInTheDocument();
  });

  it("toggles via keyboard Space key", () => {
    render(
      <Card title="Keyboard" collapsible defaultOpen={true}>
        <span>Visible</span>
      </Card>,
    );
    fireEvent.keyDown(screen.getByRole("button"), { key: " " });
    expect(screen.queryByText("Visible")).toBeNull();
  });

  it("non-collapsible card does not render a button role", () => {
    render(<Card title="Static">Content</Card>);
    expect(screen.queryByRole("button")).toBeNull();
  });

  // --- headerRight ---
  it("renders headerRight content", () => {
    render(
      <Card title="Header" headerRight={<span>Action</span>}>
        Body
      </Card>,
    );
    expect(screen.getByText("Action")).toBeInTheDocument();
  });

  it("headerRight click does not propagate to collapsible toggle", () => {
    render(
      <Card
        title="Header"
        collapsible
        defaultOpen={true}
        headerRight={<button>Edit</button>}
      >
        <span>Body</span>
      </Card>,
    );
    // Body is visible
    expect(screen.getByText("Body")).toBeInTheDocument();

    // Click the headerRight button — body should remain visible
    fireEvent.click(screen.getByText("Edit"));
    expect(screen.getByText("Body")).toBeInTheDocument();
  });
});

// ── Metric ────────────────────────────────────────────────────────

describe("Metric", () => {
  it("renders value", () => {
    render(<Metric value="$1,000" />);
    expect(screen.getByText("$1,000")).toBeInTheDocument();
  });

  it("renders label when provided", () => {
    render(<Metric value="$500" label="Savings" />);
    expect(screen.getByText("Savings")).toBeInTheDocument();
  });

  it("does not render label when omitted", () => {
    const { container } = render(<Metric value="$100" />);
    // Only the value paragraph should exist
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.textContent).toBe("$100");
  });

  it("renders positive trend with up arrow", () => {
    render(
      <Metric
        value="$500"
        label="Savings"
        trend={{ value: "5%", positive: true }}
      />,
    );
    const trendEl = screen.getByText(/5%/);
    expect(trendEl.textContent).toContain("\u2191"); // up arrow
    expect(trendEl.className).toContain("text-green-600");
  });

  it("renders negative trend with down arrow", () => {
    render(<Metric value="$200" trend={{ value: "3%", positive: false }} />);
    const trendEl = screen.getByText(/3%/);
    expect(trendEl.textContent).toContain("\u2193"); // down arrow
    expect(trendEl.className).toContain("text-red-600");
  });

  it("does not render trend when null", () => {
    const { container } = render(<Metric value="$100" trend={null} />);
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1); // just the value
  });
});

// ── ProgressBar ──────────────────────────────────────────────────

describe("ProgressBar", () => {
  it("renders percentage text", () => {
    render(<ProgressBar value={0.75} label="Progress" />);
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("Progress")).toBeInTheDocument();
  });

  it("clamps value above 1 to 100%", () => {
    render(<ProgressBar value={1.5} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("clamps negative value to 0%", () => {
    render(<ProgressBar value={-0.5} />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("renders 0% for zero value", () => {
    render(<ProgressBar value={0} />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("renders 100% for value of 1", () => {
    render(<ProgressBar value={1} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("sets the bar width via inline style", () => {
    const { container } = render(<ProgressBar value={0.5} />);
    const bar = container.querySelector("[style]");
    expect(bar).not.toBeNull();
    expect(bar!.getAttribute("style")).toContain("width: 50%");
  });

  it("sets default tooltip when none provided", () => {
    const { container } = render(<ProgressBar value={0.33} />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.getAttribute("title")).toBe("33% progress");
  });

  it("uses custom tooltip when provided", () => {
    const { container } = render(
      <ProgressBar value={0.5} tooltip="Half done" />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.getAttribute("title")).toBe("Half done");
  });

  it("applies custom color class", () => {
    const { container } = render(
      <ProgressBar value={0.5} color="bg-green-500" />,
    );
    const bar = container.querySelector("[style]");
    expect(bar!.classList.contains("bg-green-500")).toBe(true);
  });

  it("does not render label span when label is omitted", () => {
    const { container } = render(<ProgressBar value={0.5} />);
    const spans = container.querySelectorAll("span");
    // Only the percentage span, no label span
    expect(spans).toHaveLength(1);
    expect(spans[0]!.textContent).toBe("50%");
  });
});
