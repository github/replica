import { createPublicSharingService } from "../../../../domains/public-sharing/create-public-sharing-service/index.ts"
import { prisma } from "../../../../integrations/prisma/index.ts"

export function createPublicSharingRouteDependencies(environment: NodeJS.ProcessEnv) {
  return createPublicSharingService(prisma, environment)
}
