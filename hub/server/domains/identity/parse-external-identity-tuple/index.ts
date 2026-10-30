import { z } from "zod"

import type { ExternalIdentityTuple } from "../../../repositories/external-identities/find-external-identity/types.ts"
import { ExternalIdentityTupleTooLargeError } from "../errors.ts"

export const externalIdentityTupleMaxBytes = 2_000
const externalIdentityTupleSchema = z
  .object({
    provider: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/),
    issuer: z.string().min(1).max(500),
    subject: z.string().min(1).max(500),
  })
  .strict()

export function parseExternalIdentityTuple(input: unknown): ExternalIdentityTuple {
  if (
    typeof input !== "object" ||
    input === null ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    throw new Error("External identity input must be a plain object.")
  }
  const tuple = externalIdentityTupleSchema.parse(input)
  const bytes =
    Buffer.byteLength(tuple.provider, "utf8") +
    Buffer.byteLength(tuple.issuer, "utf8") +
    Buffer.byteLength(tuple.subject, "utf8") +
    2
  if (bytes > externalIdentityTupleMaxBytes) {
    throw new ExternalIdentityTupleTooLargeError()
  }
  return tuple
}
