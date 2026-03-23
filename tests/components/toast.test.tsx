import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// We test the ToastItem component indirectly through ToastContainer,
// but we need to control the toast store. We mock the hook to inject toasts.
const mockDismiss = vi.fn();

let mockToasts: Array<{
  id: string;
  message: string;
  variant: "success" | "error" | "info";
}> = [];

vi.mock("@/lib/hooks/use-toast", () => ({
  useToasts: () => ({
    toasts: mockToasts,
    dismiss: mockDismiss,
  }),
}));

// Import after mocks
import { ToastContainer } from "@/components/ui/toast";

describe("ToastContainer", () => {
  beforeEach(() => {
    mockToasts = [];
    mockDismiss.mockClear();
  });

  it("renders nothing when there are no toasts", () => {
    mockToasts = [];
    const { container } = render(<ToastContainer />);
    expect(container.innerHTML).toBe("");
  });

  it("renders a toast message", () => {
    mockToasts = [{ id: "t1", message: "File saved", variant: "success" }];
    render(<ToastContainer />);
    expect(screen.getByText("File saved")).toBeInTheDocument();
  });

  it("renders multiple toasts", () => {
    mockToasts = [
      { id: "t1", message: "First", variant: "info" },
      { id: "t2", message: "Second", variant: "error" },
    ];
    render(<ToastContainer />);
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("renders toast with alert role", () => {
    mockToasts = [{ id: "t1", message: "Alert!", variant: "info" }];
    render(<ToastContainer />);
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("Alert!");
  });

  it("calls dismiss callback when dismiss button is clicked", () => {
    mockToasts = [{ id: "t42", message: "Dismissable", variant: "info" }];
    render(<ToastContainer />);

    const dismissBtn = screen.getByLabelText("Dismiss notification");
    fireEvent.click(dismissBtn);
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    expect(mockDismiss).toHaveBeenCalledWith("t42");
  });

  it("calls dismiss with correct id for multiple toasts", () => {
    mockToasts = [
      { id: "a", message: "Toast A", variant: "success" },
      { id: "b", message: "Toast B", variant: "error" },
    ];
    render(<ToastContainer />);

    const dismissBtns = screen.getAllByLabelText("Dismiss notification");
    expect(dismissBtns).toHaveLength(2);

    // Click the second dismiss button
    fireEvent.click(dismissBtns[1]!);
    expect(mockDismiss).toHaveBeenCalledWith("b");
  });

  it("renders the aria-live polite container", () => {
    mockToasts = [{ id: "t1", message: "Polite", variant: "info" }];
    render(<ToastContainer />);
    const container = screen.getByLabelText("Notifications");
    expect(container).toHaveAttribute("aria-live", "polite");
  });

  it("applies success variant styling", () => {
    mockToasts = [{ id: "t1", message: "Done", variant: "success" }];
    render(<ToastContainer />);
    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("bg-green-50");
    expect(alert.className).toContain("border-green-300");
  });

  it("applies error variant styling", () => {
    mockToasts = [{ id: "t1", message: "Oops", variant: "error" }];
    render(<ToastContainer />);
    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("bg-red-50");
    expect(alert.className).toContain("border-red-300");
  });

  it("applies info variant styling", () => {
    mockToasts = [{ id: "t1", message: "FYI", variant: "info" }];
    render(<ToastContainer />);
    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("bg-blue-50");
    expect(alert.className).toContain("border-blue-300");
  });
});
