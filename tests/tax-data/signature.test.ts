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

describe("the release asset", () => {
  it("packs the file's exact text with its signatures, and unpacks to verify", async () => {
    const { packSignedTaxData, unpackSignedTaxData } =
      await import("@/lib/tax-data/signature");
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const keys = [
      {
        keyId: "a",
        publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
      },
    ];
    const file = '{"formatVersion":1,"dataVersion":1}\n';
    const asset = packSignedTaxData(file, [
      signTaxData(
        file,
        privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        "a",
      ),
    ]);
    const unpacked = unpackSignedTaxData(asset)!;
    expect(unpacked.fileText).toBe(file);
    expect(
      verifyTaxDataSignature(unpacked.fileText, unpacked.signature, keys),
    ).toBe(true);
    expect(unpackSignedTaxData("[]")).toBeNull();
    expect(unpackSignedTaxData("junk")).toBeNull();
  });
});
