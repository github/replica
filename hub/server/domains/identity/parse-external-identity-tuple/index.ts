import { z } from "zod"

import type { ExternalIdentityTuple } from "../../../repositories/external-identities/find-external-identity/types.ts"
import { parseProviderKey } from "../../../utils/parse-provider-key/index.ts"
import { ExternalIdentityTupleTooLargeError, ExternalIdentityTupleUnicodeError } from "../errors.ts"

export const externalIdentityTupleMaxBytes = 2_000
const externalIdentityTupleSchema = z
  .object({
    provider: z.unknown(),
    issuer: z.string().min(1).max(500),
    subject: z.string().min(1).max(500),
  })
  .strict()

function hasInvalidUnicode(value: string) {
  if (value.includes("\0")) return true
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

export function parseExternalIdentityTuple(input: unknown): ExternalIdentityTuple {
  if (
    typeof input !== "object" ||
    input === null ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    throw new Error("External identity input must be a plain object.")
  }
  const tuple = externalIdentityTupleSchema.parse(input)
  const provider = parseProviderKey(tuple.provider)
  if (hasInvalidUnicode(tuple.issuer) || hasInvalidUnicode(tuple.subject)) {
    throw new ExternalIdentityTupleUnicodeError()
  }
  const bytes =
    Buffer.byteLength(provider, "utf8") +
    Buffer.byteLength(tuple.issuer, "utf8") +
    Buffer.byteLength(tuple.subject, "utf8") +
    2
  if (bytes > externalIdentityTupleMaxBytes) {
    throw new ExternalIdentityTupleTooLargeError()
  }
  return { provider, issuer: tuple.issuer, subject: tuple.subject }
}
