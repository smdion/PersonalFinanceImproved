/** settings.taxDataSync — reviewing a community tax-data update. */
import "./setup-mocks";
import { vi, describe, it, expect } from "vitest";

vi.mock("@/lib/config/tax-data-sync", async () => {
  const { TEST_TAX_DATA_KEY: k } = await import("../helpers/tax-data-keys");
  return {
    TAX_DATA_REPO: "owner/repo",
    TAX_DATA_TAG_PREFIX: "tax-data-v",
    TAX_DATA_PUBLIC_KEYS: [{ keyId: k.keyId, publicKey: k.publicKey }],
  };
});

import { TEST_TAX_DATA_KEY as keys } from "../helpers/tax-data-keys";

import { createTestCaller, adminSession, viewerSession } from "./setup";
import { readTaxData } from "../helpers/tax-data";
import { signTaxData } from "@/lib/tax-data/signature";
import * as schema from "@/lib/db/schema-sqlite";

/** A verified update waiting for review: IRA limit 2026 → 7600. */
function addPending(
  db: Awaited<ReturnType<typeof createTestCaller>>["db"],
  { tamper = false } = {},
) {
  const f = readTaxData();
  f.dataVersion += 1;
  f.years["2026"]!.limits.ira_limit!.value = 7600;
  const fileText = JSON.stringify(f);
  db.insert(schema.taxDataUpdates)
    .values({
      dataVersion: f.dataVersion,
      fileText: tamper ? fileText.replace("7600", "9999") : fileText,
      signature: JSON.stringify([
        signTaxData(fileText, keys.privateKey, "test"),
      ]),
      status: "pending",
    })
    .run();
  return f.dataVersion;
}

const ira2026 = async (
  caller: Awaited<ReturnType<typeof createTestCaller>>["caller"],
) =>
  (await caller.settings.contributionLimits.list()).find(
    (r) => r.taxYear === 2026 && r.limitType === "ira_limit",
  )!;

describe("settings.taxDataSync", () => {
  it("shows what a waiting update changes, and approving applies exactly that", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const version = addPending(db);
      expect(
        (await caller.settings.taxDataSync.status()).pending,
      ).toMatchObject({
        dataVersion: version,
      });
      const preview = (await caller.settings.taxDataSync.preview())!;
      expect(preview.changes).toEqual([
        expect.objectContaining({
          year: 2026,
          figure: "IRA — Annual limit",
          from: 7500,
          to: 7600,
          format: "currency",
        }),
      ]);
      await caller.settings.taxDataSync.approve({
        dataVersion: version,
        diffHash: preview.diffHash,
      });
      expect(await ira2026(caller)).toMatchObject({
        origin: "community",
        shippedValue: 7600,
      });
      expect((await caller.settings.taxDataSync.status()).pending).toBeNull();
      expect(await caller.settings.taxDataSync.preview()).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("refuses to apply when the figures changed since the review", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const version = addPending(db);
      const preview = (await caller.settings.taxDataSync.preview())!;
      // The household edits the figure after reviewing.
      const row = await ira2026(caller);
      await caller.settings.contributionLimits.update({
        id: row.id,
        taxYear: 2026,
        limitType: "ira_limit",
        value: "9000",
        notes: row.notes,
      });
      await expect(
        caller.settings.taxDataSync.approve({
          dataVersion: version,
          diffHash: preview.diffHash,
        }),
      ).rejects.toThrow(/changed since you reviewed/);
      // Their edit stands either way.
      expect(Number((await ira2026(caller)).value)).toBe(9000);
    } finally {
      cleanup();
    }
  });

  it("refuses a stored file that no longer verifies", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      addPending(db, { tamper: true });
      await expect(caller.settings.taxDataSync.preview()).rejects.toThrow(
        /no longer verifies/,
      );
    } finally {
      cleanup();
    }
  });

  it("dismissing keeps the figures and stops offering it", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const version = addPending(db);
      await caller.settings.taxDataSync.dismiss({ dataVersion: version });
      expect((await caller.settings.taxDataSync.status()).pending).toBeNull();
      expect(Number((await ira2026(caller)).value)).toBe(7500);
    } finally {
      cleanup();
    }
  });

  it("anyone signed in sees the status; only an admin decides", async () => {
    const { caller, db, cleanup } = await createTestCaller(viewerSession);
    try {
      const version = addPending(db);
      expect(
        (await caller.settings.taxDataSync.status()).pending,
      ).not.toBeNull();
      await expect(
        caller.settings.taxDataSync.dismiss({ dataVersion: version }),
      ).rejects.toThrow();
      await expect(
        caller.settings.taxDataSync.setEnabled({ enabled: true }),
      ).rejects.toThrow();
    } finally {
      cleanup();
    }
  });
});
