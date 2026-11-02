import { z } from "zod"

import { providerKeyMaxBytes, providerKeyMaxCharacters } from "./constants.ts"
import type { ProviderKey } from "./types.ts"

const providerKeySchema = z.string().min(1)

export function parseProviderKey(input: unknown): ProviderKey {
  const key = providerKeySchema.parse(input)
  if (
    [...key].length > providerKeyMaxCharacters ||
    Buffer.byteLength(key, "utf8") > providerKeyMaxBytes
  ) {
    throw new Error("Provider key exceeds its bounded length.")
  }
  if (/[\p{C}\p{Z}\s]/u.test(key)) {
    throw new Error("Provider key cannot contain control or whitespace characters.")
  }
  return key as ProviderKey
}
