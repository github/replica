import { z } from "zod"

import type {
  ConsumeAuthorizationAttemptDatabase,
  ConsumeAuthorizationAttemptInput,
} from "./types.ts"

const inputSchema = z
  .object({
    browserBindingDigest: z.string().regex(/^[0-9a-f]{64}$/),
    consumedAt: z.date(),
    stateDigest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()

export async function consumeAuthorizationAttempt(
  database: ConsumeAuthorizationAttemptDatabase,
  input: ConsumeAuthorizationAttemptInput,
) {
  const parsed = inputSchema.parse(input)
  const consumed = await database.authorizationAttempt.updateMany({
    where: {
      stateDigest: parsed.stateDigest,
      browserBindingDigest: parsed.browserBindingDigest,
      consumedAt: null,
      expiresAt: { gt: parsed.consumedAt },
    },
    data: { consumedAt: parsed.consumedAt },
  })
  if (consumed.count !== 1) return null
  return database.authorizationAttempt.findUniqueOrThrow({
    where: { stateDigest: parsed.stateDigest },
  })
}
