import { createDecipheriv } from "node:crypto"

export function decryptAuthenticationValue(value: string, key: Buffer): string {
  if (key.length !== 32) throw new Error("Authentication encryption key must contain 32 bytes.")
  const parts = value.split(".")
  if (parts.length !== 3) throw new Error("Authentication ciphertext is invalid.")
  const [initializationVector, tag, ciphertext] = parts
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(initializationVector!, "base64url"),
  )
  decipher.setAuthTag(Buffer.from(tag!, "base64url"))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext!, "base64url")),
    decipher.final(),
  ]).toString("utf8")
}
