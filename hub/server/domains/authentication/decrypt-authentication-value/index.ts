import { createDecipheriv } from "node:crypto"

const INVALID_CIPHERTEXT_MESSAGE = "Authentication ciphertext is invalid."
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/

function decodeCanonicalBase64Url(value: string): Buffer {
  if (!BASE64URL_PATTERN.test(value)) throw new Error(INVALID_CIPHERTEXT_MESSAGE)
  const decoded = Buffer.from(value, "base64url")
  if (decoded.toString("base64url") !== value) throw new Error(INVALID_CIPHERTEXT_MESSAGE)
  return decoded
}

export function decryptAuthenticationValue(value: string, key: Buffer): string {
  try {
    if (key.length !== 32) throw new Error(INVALID_CIPHERTEXT_MESSAGE)
    const parts = value.split(".")
    if (parts.length !== 4 || parts[0] !== "v1") {
      throw new Error(INVALID_CIPHERTEXT_MESSAGE)
    }
    if (
      parts[1]!.length !== 16 ||
      parts[2]!.length !== 22 ||
      parts[3]!.length < 2 ||
      parts[3]!.length > 342
    ) {
      throw new Error(INVALID_CIPHERTEXT_MESSAGE)
    }
    const initializationVector = decodeCanonicalBase64Url(parts[1]!)
    const tag = decodeCanonicalBase64Url(parts[2]!)
    const ciphertext = decodeCanonicalBase64Url(parts[3]!)
    if (
      initializationVector.length !== 12 ||
      tag.length !== 16 ||
      ciphertext.length < 1 ||
      ciphertext.length > 256
    ) {
      throw new Error(INVALID_CIPHERTEXT_MESSAGE)
    }
    const decipher = createDecipheriv("aes-256-gcm", key, initializationVector, {
      authTagLength: 16,
    })
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
  } catch {
    throw new Error(INVALID_CIPHERTEXT_MESSAGE)
  }
}
