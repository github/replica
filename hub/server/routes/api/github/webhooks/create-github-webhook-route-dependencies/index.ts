import { z } from "zod"

import { revokeGitHubRepositoryAccess } from "../../../../../domains/admission/revoke-github-repository-access/index.ts"
import { prisma } from "../../../../../integrations/prisma/index.ts"
import type { GitHubWebhookRouteDependencies } from "../types.ts"

const githubId = z.number().int().positive()
const installationEvent = z.looseObject({
  action: z.enum(["deleted", "suspend", "unsuspend"]),
})
const installationRepositoriesEvent = z.looseObject({
  action: z.enum(["added", "removed"]),
  repositories_removed: z.array(z.looseObject({ id: githubId })).default([]),
})
const memberEvent = z.looseObject({
  action: z.literal("removed"),
  member: z.looseObject({ id: githubId }),
  repository: z.looseObject({ id: githubId }),
})
const organizationEvent = z.looseObject({
  action: z.literal("member_removed"),
  membership: z.looseObject({ user: z.looseObject({ id: githubId }) }),
})

/**
 * Repositories are marked disconnected rather than deleted so their Builds and
 * reviews are kept if access returns.
 */
export function createGitHubWebhookRouteDependencies(input: {
  webhookSecret: string
  installationId: string
  provider: { configurationDigest: string; revision: number }
  syncRepositories: () => Promise<unknown>
}): GitHubWebhookRouteDependencies {
  async function syncRepositories() {
    await input.syncRepositories()
    return true
  }
  return {
    installationId: input.installationId,
    webhookSecret: input.webhookSecret,
    async handleEvent(name, payload) {
      if (name === "installation") {
        const event = installationEvent.safeParse(payload)
        if (!event.success) return false
        if (event.data.action === "unsuspend") return syncRepositories()
        await revokeGitHubRepositoryAccess(
          prisma,
          { disconnect: true, githubRepositoryIds: "all" },
          input.provider,
        )
        return true
      }
      if (name === "installation_repositories") {
        const event = installationRepositoriesEvent.safeParse(payload)
        if (!event.success) return false
        // The added payload omits default branches, so read the full list instead.
        if (event.data.action === "added") return syncRepositories()
        await revokeGitHubRepositoryAccess(
          prisma,
          {
            disconnect: true,
            githubRepositoryIds: event.data.repositories_removed.map((repository) => repository.id),
          },
          input.provider,
        )
        return true
      }
      if (name === "member") {
        const event = memberEvent.safeParse(payload)
        if (!event.success) return false
        await revokeGitHubRepositoryAccess(
          prisma,
          {
            disconnect: false,
            githubRepositoryIds: [event.data.repository.id],
            githubUserId: event.data.member.id,
          },
          input.provider,
        )
        return true
      }
      if (name === "organization") {
        const event = organizationEvent.safeParse(payload)
        if (!event.success) return false
        await revokeGitHubRepositoryAccess(
          prisma,
          {
            disconnect: false,
            githubRepositoryIds: "all",
            githubUserId: event.data.membership.user.id,
          },
          input.provider,
        )
        return true
      }
      return false
    },
  }
}
