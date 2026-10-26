/**
 * Signing and verifying a tax-data file. A signature covers the file's
 * exact bytes, prefixed so it can't be reused for anything else; the
 * `.sig` file is JSON `[{ keyId, sig }]` (base64), so a release can carry
 * one signature per key during a rotation. A file verifies when any
 * bundled key's signature checks out — checked before the file is parsed.
 */
import { createPrivateKey, createPublicKey, sign, verify } from "crypto";
import { TAX_DATA_PUBLIC_KEYS } from "@/lib/config/tax-data-sync";

const PREFIX = "ledgr-tax-data\n";

export type TaxDataSignature = { keyId: string; sig: string }[];

const signed = (fileBytes: string | Buffer) =>
  Buffer.concat([Buffer.from(PREFIX), Buffer.from(fileBytes)]);

/** One key's signature over the file's bytes. */
export function signTaxData(
  fileBytes: string | Buffer,
  privateKeyPem: string,
  keyId: string,
): TaxDataSignature[number] {
  return {
    keyId,
    sig: sign(
      null,
      signed(fileBytes),
      createPrivateKey(privateKeyPem),
    ).toString("base64"),
  };
}

/** Does any of `keys` verify one of the signatures over these bytes? */
export function verifyTaxDataSignature(
  fileBytes: string | Buffer,
  signatureText: string,
  keys: readonly { keyId: string; publicKey: string }[] = TAX_DATA_PUBLIC_KEYS,
): boolean {
  let sigs: TaxDataSignature;
  try {
    sigs = JSON.parse(signatureText) as TaxDataSignature;
  } catch {
    return false;
  }
  if (!Array.isArray(sigs)) return false;
  const data = signed(fileBytes);
  return sigs.some((s) => {
    const key = keys.find((k) => k.keyId === s?.keyId);
    if (!key || typeof s.sig !== "string") return false;
    try {
      return verify(
        null,
        data,
        createPublicKey(key.publicKey),
        Buffer.from(s.sig, "base64"),
      );
    } catch {
      return false;
    }
  });
}
