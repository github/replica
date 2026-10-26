import { randomBytes } from "node:crypto"
import { z } from "zod"

import { digestSecret } from "#server/utils/digest-secret"
import type { IdentityDependencies } from "#server/utils/identity-contracts/types"
import { IdentityError } from "#server/utils/identity-error"

const demoProfileSchema = z
  .object({
    subject: z.string().trim().min(1).max(200),
    login: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .strict()

export async function signInWithOidcDemo(dependencies: IdentityDependencies, input: unknown) {
  const { settings, store, now } = dependencies
  if (!settings.demoMode || !settings.signInProviders.includes("oidc-demo")) {
    throw new IdentityError(
      404,
      "provider_unavailable",
      "The local OIDC demo provider is not enabled.",
    )
  }
  const parsed = demoProfileSchema.safeParse(input)
  if (!parsed.success) {
    throw new IdentityError(400, "invalid_demo_identity", "Enter a valid local demo identity.")
  }

  const token = randomBytes(32).toString("base64url")
  await store.lock(async (records) => {
    const user = await records.saveUser({
      provider: "oidc-demo",
      providerId: parsed.data.subject,
      login: parsed.data.login,
      name: parsed.data.name ?? null,
      avatarUrl: null,
    })
    const session = await records.createSession({
      tokenDigest: digestSecret(token),
      userId: user.id,
      signedInAt: now(),
      freshAuthorizedAt: now(),
      credentialRevision: "oidc-demo:v1",
    })
    await records.audit({
      event: "session.sign_in",
      actorId: user.id,
      sessionId: session.id,
    })
  })
  return { token }
}
