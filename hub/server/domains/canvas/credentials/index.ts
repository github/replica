import { createHash, randomBytes } from "node:crypto"

export const pairingLifetime = 10 * 60_000
export const accessLifetime = 7 * 24 * 60 * 60_000
export const inactiveLifetime = 30 * 24 * 60 * 60_000
export const devicePattern = /^[A-Za-z0-9_-]{43}$/
export const accessPattern = /^rp_[A-Za-z0-9_-]{43}$/
export const refreshPattern = /^rr_[A-Za-z0-9_-]{43}$/
export const userCodePattern = /^[A-F0-9]{10}$/

export function canvasDigest(secret: string) {
  return createHash("sha256").update(secret).digest("hex")
}

export function canvasSecret(prefix = "") {
  return prefix + randomBytes(32).toString("base64url")
}

export function canvasCredentials(
  grant: { id: number; expiresAt: Date; inactiveAt: Date | null },
  accessToken: string,
  repository: string,
  login: string,
) {
  return {
    accessToken,
    expiresAt: grant.expiresAt.toISOString(),
    connectionId: grant.id,
    inactiveAt: grant.inactiveAt?.toISOString() ?? null,
    repository,
    login,
  }
}
