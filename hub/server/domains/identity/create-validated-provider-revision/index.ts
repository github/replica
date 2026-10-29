import { createHash } from "node:crypto"
import { z } from "zod"

import type { Prisma } from "../../../generated/prisma/client.ts"
import type { CreateValidatedProviderRevisionInput, ValidatedProviderRevision } from "./types.ts"

const sensitiveKey = /(?:authorization|cookie|credential|password|private.?key|secret|token)/i
const providerKeySchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/)

function isJsonArray(value: Prisma.InputJsonValue): value is Prisma.InputJsonArray {
  return Array.isArray(value)
}

function normalizeSettingsObject(value: Prisma.InputJsonObject, depth = 0): Prisma.InputJsonObject {
  if (depth > 4) throw new Error("Provider settings cannot exceed four nested levels.")
  const entries = Object.entries(value)
  if (entries.length > 32) throw new Error("Provider settings cannot exceed 32 fields per object.")
  return Object.fromEntries(
    entries
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => {
        if (!key.length || key.length > 100) {
          throw new Error("Provider setting keys must contain between 1 and 100 characters.")
        }
        if (sensitiveKey.test(key)) {
          throw new Error("Provider settings cannot contain credentials or secrets.")
        }
        if (item === undefined) {
          throw new Error("Provider settings cannot contain undefined values.")
        }
        return [key, normalizeSettingValue(item, depth + 1)]
      }),
  )
}

function normalizeSettingValue(
  value: Prisma.InputJsonValue | null,
  depth: number,
): Prisma.InputJsonValue | null {
  if (depth > 4) throw new Error("Provider settings cannot exceed four nested levels.")
  if (value === null || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Provider setting numbers must be finite.")
    return value
  }
  if (typeof value === "string") {
    if (value.length > 2_000) {
      throw new Error("Provider setting strings cannot exceed 2000 characters.")
    }
    return value
  }
  if (isJsonArray(value)) {
    if (value.length > 32) throw new Error("Provider setting arrays cannot exceed 32 items.")
    return value.map((item) => normalizeSettingValue(item, depth + 1))
  }
  if ("toJSON" in value) throw new Error("Provider settings must be plain JSON data.")
  return normalizeSettingsObject(value, depth)
}

export function createValidatedProviderRevision(
  input: CreateValidatedProviderRevisionInput,
): ValidatedProviderRevision {
  const providerKey = providerKeySchema.parse(input.providerKey)
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw new Error("Provider revision must be a positive safe integer.")
  }
  const settings = normalizeSettingsObject(input.settings)
  const serialized = JSON.stringify(settings)
  if (Buffer.byteLength(serialized, "utf8") > 16_384) {
    throw new Error("Provider settings cannot exceed 16384 bytes.")
  }

  return {
    providerKey,
    revision: input.revision,
    settings,
    configurationDigest: createHash("sha256").update(serialized).digest("hex"),
  }
}
