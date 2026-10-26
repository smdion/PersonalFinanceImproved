/** A throwaway Ed25519 key pair for signing tax-data files in tests. */
import { generateKeyPairSync } from "crypto";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
export const TEST_TAX_DATA_KEY = {
  keyId: "test",
  publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};
