import { z } from "zod"

import type {
  CreateAuthorizationAttemptDatabase,
  CreateAuthorizationAttemptInput,
} from "./types.ts"

const inputSchema = z
  .object({
    browserBindingDigest: z.string().regex(/^[0-9a-f]{64}$/),
    codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    codeVerifierCiphertext: z.string().min(1).max(500),
    expiresAt: z.date(),
    id: z.uuid(),
    providerRevisionId: z.uuid(),
    requestIpDigest: z.string().regex(/^[0-9a-f]{64}$/),
    stateDigest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()

export function createAuthorizationAttempt(
  database: CreateAuthorizationAttemptDatabase,
  input: CreateAuthorizationAttemptInput,
) {
  return database.authorizationAttempt.create({ data: inputSchema.parse(input) })
}
