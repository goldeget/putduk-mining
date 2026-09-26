import "server-only";

import { createCipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const ENVELOPE_VERSION = 1;

export type EncryptedEnvelope = {
  algorithm: "A256GCM";
  ciphertext: string;
  iv: string;
  keyVersion: number;
  tag: string;
};

export function encryptSensitiveData({
  additionalData,
  keyBase64,
  value,
}: {
  additionalData: string;
  keyBase64: string;
  value: Record<string, string>;
}): EncryptedEnvelope {
  const key = Buffer.from(keyBase64, "base64");
  if (key.byteLength !== 32) {
    throw new Error("INVALID_WITHDRAWAL_DATA_KEY");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(additionalData, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);

  return {
    algorithm: "A256GCM",
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    keyVersion: ENVELOPE_VERSION,
    tag: cipher.getAuthTag().toString("base64"),
  };
}
