import type { OAuthAttempt } from "#server/repositories/oauth-attempts/types"

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function consumeOAuthAttempt(
  database: Prisma.TransactionClient,
  stateDigest: string,
): Promise<OAuthAttempt | null> {
  const attempt = await database.oAuthAttempt.findUnique({ where: { stateDigest } })
  if (!attempt) return null
  await database.oAuthAttempt.delete({ where: { id: attempt.id } })
  if (
    attempt.purpose !== "sign-in" &&
    attempt.purpose !== "verify" &&
    attempt.purpose !== "enroll"
  ) {
    throw new Error("Stored OAuth purpose is invalid.")
  }
  return { ...attempt, purpose: attempt.purpose }
}
