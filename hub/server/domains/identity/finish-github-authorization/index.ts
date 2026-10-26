import { randomBytes } from "node:crypto"

import { getIdentityConfiguration } from "#server/domains/identity/get-identity-configuration"
import { digestSecret } from "#server/utils/digest-secret"
import type { IdentityDependencies, IdentityRecords } from "#server/utils/identity-contracts/types"
import { IdentityError } from "#server/utils/identity-error"

import type { VerifiedGitHubAuthorization } from "./types.ts"

export async function finishGitHubAuthorization(
  dependencies: IdentityDependencies,
  input: VerifiedGitHubAuthorization,
  records: IdentityRecords,
): Promise<{ token?: string }> {
  const { now } = dependencies
  const { attempt, profile, verifiedAt, admitted } = input

  const latest = await getIdentityConfiguration(dependencies, records)
  if (
    latest.revision !== attempt.credentialRevision ||
    latest.state.generation !== attempt.generation ||
    attempt.expiresAt <= now()
  ) {
    throw new IdentityError(
      401,
      "sign_in_cancelled",
      "Hub credentials or sessions changed. Start a new sign-in.",
    )
  }
  if (attempt.purpose === "verify") {
    const session = attempt.sessionId ? await records.sessionById(attempt.sessionId) : null
    if (!session) {
      throw new IdentityError(
        401,
        "sign_in_required",
        "The initiating browser session has ended. Sign in again.",
      )
    }
    const currentUser = await records.user(session.userId)
    if (
      !currentUser ||
      currentUser.provider !== "github" ||
      currentUser.providerId !== profile.providerId
    ) {
      throw new IdentityError(
        403,
        "identity_mismatch",
        "Verify the same GitHub account that started this request.",
      )
    }
    await records.verifySession(session.id, verifiedAt, latest.revision)
    await records.audit({
      event: "session.verify",
      actorId: currentUser.id,
      sessionId: session.id,
    })
    return {}
  }
  let user = await records.saveUser(profile)
  if (attempt.purpose === "enroll") user = await records.enroll(user.id)
  if (!admitted && !user.administrator) {
    throw new IdentityError(
      403,
      "repository_access_required",
      "Access to an installed repository is required to sign in.",
    )
  }
  const token = randomBytes(32).toString("base64url")
  const session = await records.createSession({
    tokenDigest: digestSecret(token),
    userId: user.id,
    signedInAt: now(),
    freshAuthorizedAt: verifiedAt,
    credentialRevision: latest.revision,
  })
  await records.audit({
    event: attempt.purpose === "enroll" ? "operator.enroll" : "session.sign_in",
    actorId: user.id,
    sessionId: session.id,
  })
  return { token }
}
