import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

import type { DestinationConfiguration } from "../types.ts"

interface DestinationIdentity {
  id: string
  repositoryId: string
  provider: string
}

function associatedData(destination: DestinationIdentity) {
  return Buffer.from(
    `analytics/v1/${destination.repositoryId}/${destination.id}/${destination.provider}`,
  )
}

export function sealAnalyticsConfiguration(
  identity: DestinationIdentity,
  configuration: DestinationConfiguration,
  key: Buffer,
) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  cipher.setAAD(associatedData(identity))
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(configuration), "utf8"),
    cipher.final(),
  ])
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".")
}

export function openAnalyticsConfiguration(
  destination: DestinationIdentity & { configurationCiphertext: string },
  key: Buffer,
): DestinationConfiguration {
  const [version, iv, tag, body] = destination.configurationCiphertext.split(".")
  if (version !== "v1" || !iv || !tag || !body)
    throw new Error("Invalid encrypted analytics configuration.")
  const cipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"), {
    authTagLength: 16,
  })
  cipher.setAAD(associatedData(destination))
  cipher.setAuthTag(Buffer.from(tag, "base64url"))
  return JSON.parse(
    Buffer.concat([cipher.update(Buffer.from(body, "base64url")), cipher.final()]).toString("utf8"),
  ) as DestinationConfiguration
}
