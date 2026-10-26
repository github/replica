import type { GitHubProfile } from "#server/utils/identity-contracts/types"

import type { Prisma } from "../../../generated/prisma/client.ts"

export function saveGitHubUser(database: Prisma.TransactionClient, profile: GitHubProfile) {
  return database.user.upsert({
    where: { provider_providerId: { provider: "github", providerId: profile.providerId } },
    create: { ...profile, provider: "github" },
    update: profile,
  })
}
