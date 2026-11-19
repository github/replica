import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto"

import type { AnalyticsMutation } from "../create-destination-service/index.ts"
import { AnalyticsSettingsError } from "../errors.ts"

type AuthorizationScope = {
  id: string
  repositoryId: string
  hubSessionId: string
  externalIdentityId: string
}
type SavedChange = { mutation: AnalyticsMutation; targetUpdatedAt: string | null }

function context(scope: AuthorizationScope) {
  return Buffer.from(
    `analytics-intent/v1/${scope.id}/${scope.repositoryId}/${scope.hubSessionId}/${scope.externalIdentityId}`,
  )
}

function keyFor(key: Buffer) {
  return Buffer.from(hkdfSync("sha256", key, "", "replica analytics pending intent", 32))
}

export function sealPendingAnalyticsChange(
  scope: AuthorizationScope,
  saved: SavedChange,
  key: Buffer,
) {
  const body = JSON.stringify(saved)
  if (Buffer.byteLength(body) > 48 * 1024)
    throw new AnalyticsSettingsError(422, "Analytics settings are too large.")
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", keyFor(key), iv)
  cipher.setAAD(context(scope))
  const ciphertext = Buffer.concat([cipher.update(body, "utf8"), cipher.final()])
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".")
}

export function openPendingAnalyticsChange(
  scope: AuthorizationScope & { mutationCiphertext: string },
  key: Buffer,
) {
  try {
    const [version, iv, tag, body] = scope.mutationCiphertext.split(".")
    if (version !== "v1" || !iv || !tag || !body) throw new Error("Invalid intent.")
    const cipher = createDecipheriv("aes-256-gcm", keyFor(key), Buffer.from(iv, "base64url"), {
      authTagLength: 16,
    })
    cipher.setAAD(context(scope))
    cipher.setAuthTag(Buffer.from(tag, "base64url"))
    return JSON.parse(
      Buffer.concat([cipher.update(Buffer.from(body, "base64url")), cipher.final()]).toString(
        "utf8",
      ),
    ) as SavedChange
  } catch {
    throw new AnalyticsSettingsError(
      409,
      "The saved change is no longer available. Submit it again.",
    )
  }
}
