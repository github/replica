import { randomBytes } from "node:crypto"

export function createOpaqueValue(bytes = 32): string {
  return randomBytes(bytes).toString("base64url")
}
