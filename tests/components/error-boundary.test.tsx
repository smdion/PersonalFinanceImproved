import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "@/components/ui/error-boundary";

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("Boom");
  return <div>All good</div>;
}

describe("ErrorBoundary", () => {
  // Suppress React error boundary console.error noise
  const originalError = console.error;
  beforeEach(() => {
    console.error = vi.fn();
  });
  afterEach(() => {
    console.error = originalError;
  });

  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <div>Child content</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("renders default fallback when child throws", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
  });

  it("renders custom fallback when provided", () => {
    render(
      <ErrorBoundary fallback={<div>Custom error</div>}>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Custom error")).toBeInTheDocument();
  });

  it('recovers when "Try again" is clicked', () => {
    // Use a ref-like flag outside React to control throwing
    let shouldThrow = true;

    function MaybeThrow() {
      if (shouldThrow) throw new Error("Once");
      return <div>Recovered</div>;
    }

    render(
      <ErrorBoundary>
        <MaybeThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();

    // Stop throwing before clicking retry
    shouldThrow = false;
    fireEvent.click(screen.getByText("Try again"));
    expect(screen.getByText("Recovered")).toBeInTheDocument();
  });
});
