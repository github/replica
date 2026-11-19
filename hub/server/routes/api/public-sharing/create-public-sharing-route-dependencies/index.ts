import { configureHostedSharingPolicy } from "../../../../domains/public-sharing/configure-hosted-sharing-policy/index.ts"
import { createPublicSharingService } from "../../../../domains/public-sharing/create-public-sharing-service/index.ts"
import { PublicSharingConfigurationError } from "../../../../domains/public-sharing/errors.ts"
import { readHostedPublicSharingEnabled } from "../../../../domains/public-sharing/read-hosted-public-sharing-enabled/index.ts"
import { prisma } from "../../../../integrations/prisma/index.ts"
import type { PublicSharingRouteDependencies } from "../types.ts"

export function createPublicSharingRouteDependencies(
  environment: NodeJS.ProcessEnv,
): Promise<PublicSharingRouteDependencies>
export function createPublicSharingRouteDependencies(
  environment: NodeJS.ProcessEnv,
  options: { hostedReady: boolean } | undefined,
): Promise<PublicSharingRouteDependencies | undefined>
export async function createPublicSharingRouteDependencies(
  environment: NodeJS.ProcessEnv,
  options?: { hostedReady: boolean },
) {
  if (!options) return createPublicSharingService(prisma, environment)
  if (options.hostedReady)
    return createPublicSharingService(prisma, environment, { mode: "hosted" })

  // Dropping a prerequisite must not leave the previous policy active.
  await configureHostedSharingPolicy(prisma, false)
  if (readHostedPublicSharingEnabled(environment.HUB_HOSTED_PUBLIC_SHARING_ENABLED)) {
    throw new PublicSharingConfigurationError(
      "Hosted public sharing requires GitHub repository permissions and configured Build previews.",
    )
  }
  return undefined
}
