import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedEnvelope = {
  nonce: string;
  ciphertext: string;
  tag: string;
};

export function parseMasterKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) {
    throw new Error("ORGOPS_MASTER_KEY must be 32 bytes base64");
  }
  return key;
}

export function encryptSecret(masterKey: Buffer, plaintext: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope: EncryptedEnvelope = {
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: tag.toString("base64")
  };
  return Buffer.from(JSON.stringify(envelope), "utf-8").toString("base64");
}

export function decryptSecret(masterKey: Buffer, envelopeB64: string): string {
  const payload = Buffer.from(envelopeB64, "base64").toString("utf-8");
  const envelope = JSON.parse(payload) as EncryptedEnvelope;
  const nonce = Buffer.from(envelope.nonce, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const decipher = createDecipheriv("aes-256-gcm", masterKey, nonce);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf-8");
}
