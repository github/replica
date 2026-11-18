import { createPrivateKey } from "node:crypto"
import type { KeyObject } from "node:crypto"

export function readGitHubAppPrivateKey(value: string): KeyObject | undefined {
  try {
    const bytes = Buffer.from(value, "base64")
    if (bytes.toString("base64") !== value) return undefined
    const pem = bytes.toString("utf8")
    if (!pem.includes("PRIVATE KEY-----")) return undefined
    const key = createPrivateKey(pem)
    return key.asymmetricKeyType === "rsa" ? key : undefined
  } catch {
    return undefined
  }
}
