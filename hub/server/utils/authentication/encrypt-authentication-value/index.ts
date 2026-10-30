import { createCipheriv, randomBytes } from "node:crypto"

export function encryptAuthenticationValue(value: string, key: Buffer): string {
  if (key.length !== 32) throw new Error("Authentication encryption key must contain 32 bytes.")
  const initializationVector = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, initializationVector)
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  return [
    initializationVector.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".")
}
