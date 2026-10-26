import { z } from "zod"

import { createDemoSession } from "#server/domains/identity/create-demo-session"
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
  const { settings } = dependencies
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

  return createDemoSession(
    dependencies,
    {
      provider: "oidc-demo",
      providerId: parsed.data.subject,
      login: parsed.data.login,
      name: parsed.data.name ?? null,
      avatarUrl: null,
    },
    "oidc-demo:v1",
  )
}
