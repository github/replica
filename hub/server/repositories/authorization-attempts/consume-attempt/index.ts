import type { AuthorizationAttempt } from "#server/repositories/authorization-attempts/types"

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function consumeAuthorizationAttempt(
  database: Prisma.TransactionClient,
  stateDigest: string,
): Promise<AuthorizationAttempt | null> {
  const attempt = await database.authorizationAttempt.findUnique({ where: { stateDigest } })
  if (!attempt) return null
  await database.authorizationAttempt.delete({ where: { id: attempt.id } })
  if (
    attempt.purpose !== "sign-in" &&
    attempt.purpose !== "verify" &&
    attempt.purpose !== "link-identity"
  ) {
    throw new Error("Stored authorization purpose is invalid.")
  }
  return { ...attempt, purpose: attempt.purpose }
}
