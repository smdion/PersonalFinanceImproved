/**
 * Signs and verifies a tax-data file's exact bytes; it verifies when any bundled
 * key's signature checks out. No `server-only`: scripts/tax-data-publish.ts uses it
 * outside Next. Keep it out of client components.
 */
import { createPrivateKey, createPublicKey, sign, verify } from "crypto";
import { TAX_DATA_PUBLIC_KEYS } from "@/lib/config/tax-data-sync";

const PREFIX = "ledgr-tax-data\n";

type TaxDataSignature = { keyId: string; sig: string }[];

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
    // Parsed signature text: an element can be any JSON, even null.
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

/** The release asset: the file's exact text and its signatures, in one
 *  JSON document. */
export function packSignedTaxData(
  fileText: string,
  signatures: TaxDataSignature,
): string {
  return JSON.stringify({ file: fileText, signatures }, null, 2) + "\n";
}

/** The file text and signature JSON from a release asset, or null when it
 *  isn't one. Not verified — `verifyTaxDataSignature` does that. */
export function unpackSignedTaxData(
  assetText: string,
): { fileText: string; signature: string } | null {
  try {
    const a = JSON.parse(assetText) as { file?: unknown; signatures?: unknown };
    if (typeof a.file !== "string" || !Array.isArray(a.signatures)) return null;
    return { fileText: a.file, signature: JSON.stringify(a.signatures) };
  } catch {
    return null;
  }
}
