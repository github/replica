import { randomBytes } from "node:crypto"

import { digestSecret } from "#server/utils/digest-secret"
import type { IdentityDependencies, IdentityProfile } from "#server/utils/identity-contracts/types"

export async function createDemoSession(
  dependencies: IdentityDependencies,
  profile: IdentityProfile,
  credentialRevision: string,
) {
  const { store, now } = dependencies
  const token = randomBytes(32).toString("base64url")
  await store.lock(async (records) => {
    const user = await records.saveUser(profile)
    const session = await records.createSession({
      tokenDigest: digestSecret(token),
      userId: user.id,
      signedInAt: now(),
      freshAuthorizedAt: now(),
      credentialRevision,
    })
    await records.audit({
      event: "session.sign_in",
      actorId: user.id,
      sessionId: session.id,
    })
  })
  return { token }
}
