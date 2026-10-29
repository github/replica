import { createHash } from "node:crypto"
import { z } from "zod"

import { normalizeSecretFreeJson } from "../../../utils/normalize-secret-free-json/index.ts"
import type { CreateValidatedProviderRevisionInput, ValidatedProviderRevision } from "./types.ts"

const providerKeySchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/)

export function createValidatedProviderRevision(
  input: CreateValidatedProviderRevisionInput,
): ValidatedProviderRevision {
  const providerKey = providerKeySchema.parse(input.providerKey)
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw new Error("Provider revision must be a positive safe integer.")
  }
  let settings
  try {
    settings = normalizeSecretFreeJson(input.settings, {
      maxArrayItems: 32,
      maxBytes: 16_384,
      maxDepth: 4,
      maxEntries: 128,
      maxKeyLength: 100,
      maxObjectFields: 32,
      maxStringLength: 2_000,
    })
  } catch (error) {
    if (!(error instanceof Error)) throw error
    throw new Error(
      error.message
        .replace("JSON data", "Provider settings")
        .replace("JSON arrays", "Provider setting arrays")
        .replace("JSON objects", "Provider setting objects")
        .replace("JSON keys", "Provider setting keys")
        .replace("JSON string values", "Provider setting values")
        .replace("JSON numbers", "Provider setting numbers")
        .replace("JSON values", "Provider setting values"),
      { cause: error },
    )
  }
  const serialized = JSON.stringify(settings)

  return {
    providerKey,
    revision: input.revision,
    settings,
    configurationDigest: createHash("sha256").update(serialized).digest("hex"),
  }
}
