import { createCipheriv, randomBytes } from "node:crypto"

export function encryptAuthenticationValue(value: string, key: Buffer): string {
  if (key.length !== 32) throw new Error("Authentication encryption key must contain 32 bytes.")
  if (!value || Buffer.byteLength(value, "utf8") > 256) {
    throw new Error("Authentication value must contain between 1 and 256 bytes.")
  }
  const initializationVector = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, initializationVector, {
    authTagLength: 16,
  })
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  return [
    "v1",
    initializationVector.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".")
}
