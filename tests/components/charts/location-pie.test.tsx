import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LocationPie } from "@/components/charts/location-pie";

describe("LocationPie", () => {
  it("lists each slice's share of the total and its amount, and summarizes the pie", () => {
    const { container } = render(
      <LocationPie
        label="Tax location"
        total={400}
        data={[
          { name: "Roth", value: 300, color: "#000000" },
          { name: "HSA", value: 50, color: "#111111" },
        ]}
      />,
    );
    expect(
      screen.getByText("Roth").parentElement?.parentElement,
    ).toHaveTextContent("Roth75%$300.00");
    expect(
      screen.getByText("HSA").parentElement?.parentElement,
    ).toHaveTextContent("HSA13%$50.00");
    expect(container.querySelector(".sr-only")).toHaveTextContent(
      "Tax location: Roth $300.00; HSA $50.00.",
    );
  });
});
