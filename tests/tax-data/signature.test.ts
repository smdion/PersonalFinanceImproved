import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "crypto";
import { signTaxData, verifyTaxDataSignature } from "@/lib/tax-data/signature";

const pair = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
};

describe("tax-data signatures", () => {
  const a = pair();
  const b = pair();
  const keys = [{ keyId: "a", publicKey: a.publicKey }];
  const file = '{"formatVersion":1,"dataVersion":3}\n';

  it("verifies a file signed by a bundled key", () => {
    const sig = JSON.stringify([signTaxData(file, a.privateKey, "a")]);
    expect(verifyTaxDataSignature(file, sig, keys)).toBe(true);
  });

  it("refuses a changed byte, an unknown key, or a mislabelled signature", () => {
    const sig = JSON.stringify([signTaxData(file, a.privateKey, "a")]);
    expect(verifyTaxDataSignature(file + " ", sig, keys)).toBe(false);
    const byB = JSON.stringify([signTaxData(file, b.privateKey, "b")]);
    expect(verifyTaxDataSignature(file, byB, keys)).toBe(false);
    const forged = JSON.stringify([signTaxData(file, b.privateKey, "a")]);
    expect(verifyTaxDataSignature(file, forged, keys)).toBe(false);
  });

  it("accepts any one good signature during a key rotation", () => {
    const sig = JSON.stringify([
      signTaxData(file, b.privateKey, "b"),
      signTaxData(file, a.privateKey, "a"),
    ]);
    expect(verifyTaxDataSignature(file, sig, keys)).toBe(true);
  });

  it("refuses junk and an empty key list", () => {
    expect(verifyTaxDataSignature(file, "not json", keys)).toBe(false);
    expect(verifyTaxDataSignature(file, "{}", keys)).toBe(false);
    const sig = JSON.stringify([signTaxData(file, a.privateKey, "a")]);
    expect(verifyTaxDataSignature(file, sig, [])).toBe(false);
  });
});
