import { z } from "zod"

import type { ExternalIdentityTuple } from "../../../repositories/external-identities/find-external-identity/types.ts"

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
  return externalIdentityTupleSchema.parse(input)
}
