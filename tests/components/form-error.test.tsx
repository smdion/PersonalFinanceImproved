/**
 * FormError — the server's sentence for a failed service
 * wins over the raw message; otherwise the message shows as before.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormError } from "@/components/ui/form-error";

const serviceError = {
  message: "Actual: /accounts: data.0.offbudget: expected boolean",
  data: {
    userMessage:
      "Actual sent something Ledgr doesn't understand (data.0.offbudget). Nothing was changed.",
  },
};

describe.each([["FormError", FormError]])("%s", (_name, Component) => {
  it("shows data.userMessage instead of the raw message", () => {
    render(<Component error={serviceError} prefix="Sync failed" />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sync failed: Actual sent something Ledgr doesn't understand (data.0.offbudget). Nothing was changed.",
    );
  });

  it("shows the error's message when there is no userMessage", () => {
    render(<Component error={{ message: "Name is required" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Name is required");
  });

  it("renders nothing without an error", () => {
    const { container } = render(<Component error={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
