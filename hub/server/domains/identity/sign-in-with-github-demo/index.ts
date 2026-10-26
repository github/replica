import { z } from "zod"

import { createDemoSession } from "#server/domains/identity/create-demo-session"
import { getIdentityConfiguration } from "#server/domains/identity/get-identity-configuration"
import type { IdentityDependencies } from "#server/utils/identity-contracts/types"
import { IdentityError } from "#server/utils/identity-error"

const demoProfileSchema = z
  .object({
    subject: z.string().trim().min(1).max(200),
    login: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .strict()

export async function signInWithGitHubDemo(dependencies: IdentityDependencies, input: unknown) {
  const { settings } = dependencies
  if (!settings.demoMode || !settings.signInProviders.includes("github")) {
    throw new IdentityError(
      404,
      "provider_unavailable",
      "The local GitHub sign-in simulation is not enabled.",
    )
  }
  if (settings.repositoryProvider !== "github") {
    throw new IdentityError(
      409,
      "repository_provider_unavailable",
      "The GitHub sign-in simulation requires GitHub repository integration.",
    )
  }
  const parsed = demoProfileSchema.safeParse(input)
  if (!parsed.success) {
    throw new IdentityError(400, "invalid_demo_identity", "Enter a valid local demo identity.")
  }
  const configuration = await getIdentityConfiguration(dependencies)

  return createDemoSession(
    dependencies,
    {
      provider: "github",
      providerId: parsed.data.subject,
      login: parsed.data.login,
      name: parsed.data.name ?? null,
      avatarUrl: null,
    },
    configuration.revision,
  )
}
