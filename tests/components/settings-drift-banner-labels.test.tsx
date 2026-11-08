/**
 * The integrations profile selector's Profile: and Mode: labels reach their
 * selects.
 */
import { describe, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { resetTrpcMock } from "./trpc-mock";
import { expectLabelReachesControl } from "./label-click";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

import { DriftBanner } from "@/components/settings/integrations/drift-banner";

describe("DriftBanner labels", () => {
  beforeEach(() => resetTrpcMock());

  it("clicking Profile: and Mode: reaches their selects", () => {
    render(
      <DriftBanner
        service="ynab"
        profile={
          {
            availableProfiles: [{ id: 1, name: "Household", isActive: true }],
            linkedProfileId: 1,
            columnLabels: ["Lean", "Full"],
            linkedColumnIndex: 0,
          } as never
        }
        totalDrifted={0}
      />,
    );
    expectLabelReachesControl("Profile:");
    expectLabelReachesControl("Mode:");
  });
});
