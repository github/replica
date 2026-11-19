import { z } from "zod"

import { revokeGitHubRepositoryAccess } from "../../../../../domains/admission/revoke-github-repository-access/index.ts"
import { prisma } from "../../../../../integrations/prisma/index.ts"
import type { GitHubWebhookRouteDependencies } from "../types.ts"

const githubId = z.number().int().positive()
const webhookAction = z.looseObject({ action: z.string() })
const installationEvent = z.looseObject({
  action: z.enum(["deleted", "suspend", "unsuspend"]),
})
const installationRepositoriesEvent = z.looseObject({
  action: z.enum(["added", "removed"]),
  repositories_removed: z.array(z.looseObject({ id: githubId })).optional(),
})
const memberEvent = z.looseObject({
  action: z.enum(["edited", "removed"]),
  member: z.looseObject({ id: githubId }),
  repository: z.looseObject({ id: githubId }),
})
const organizationEvent = z.looseObject({
  action: z.literal("member_removed"),
  membership: z.looseObject({ user: z.looseObject({ id: githubId }) }),
})
const team = z.looseObject({ id: githubId })
const membershipEvent = z.looseObject({
  action: z.literal("removed"),
  scope: z.string(),
  member: z.looseObject({ id: githubId }).nullable(),
  team,
})
const teamRepositoryEvent = z.looseObject({
  action: z.literal("removed_from_repository"),
  repository: z.looseObject({ id: githubId.nullish() }).nullish(),
  team,
})
const teamDeletedEvent = z.looseObject({
  action: z.literal("deleted"),
  team,
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
    async handleEvent(name, payload, delivery) {
      const receipt = { ...delivery, event: name }
      const action = webhookAction.safeParse(payload)
      if (!action.success) {
        if (name === "membership" || name === "team") {
          throw new Error("Invalid GitHub team webhook event.")
        }
        return false
      }
      if (name === "installation") {
        const event = installationEvent.safeParse(payload)
        if (!event.success) return false
        if (event.data.action === "unsuspend") return syncRepositories()
        await revokeGitHubRepositoryAccess(
          prisma,
          { delivery: receipt, disconnect: true, githubRepositoryIds: "all" },
          input.provider,
        )
        return true
      }
      if (name === "installation_repositories") {
        const event = installationRepositoriesEvent.safeParse(payload)
        if (!event.success) {
          if (action.data.action === "removed") {
            throw new Error("Invalid GitHub installation repository removal event.")
          }
          return false
        }
        // The added payload omits default branches, so read the full list instead.
        if (event.data.action === "added") return syncRepositories()
        if (!event.data.repositories_removed) {
          throw new Error("Invalid GitHub installation repository removal event.")
        }
        await revokeGitHubRepositoryAccess(
          prisma,
          {
            delivery: receipt,
            disconnect: true,
            githubRepositoryIds: event.data.repositories_removed.map((repository) => repository.id),
          },
          input.provider,
        )
        return true
      }
      if (name === "member") {
        if (action.data.action !== "edited" && action.data.action !== "removed") return false
        const event = memberEvent.parse(payload)
        await revokeGitHubRepositoryAccess(
          prisma,
          {
            delivery: receipt,
            disconnect: false,
            githubRepositoryIds: [event.repository.id],
            githubUserId: event.member.id,
          },
          input.provider,
        )
        return true
      }
      if (name === "organization") {
        if (action.data.action !== "member_removed") return false
        const event = organizationEvent.parse(payload)
        await revokeGitHubRepositoryAccess(
          prisma,
          {
            delivery: receipt,
            disconnect: false,
            githubRepositoryIds: "all",
            githubUserId: event.membership.user.id,
          },
          input.provider,
        )
        return true
      }
      if (name === "membership" || name === "team") {
        if (name === "membership" && action.data.action === "removed") {
          const event = membershipEvent.parse(payload)
          if (event.scope !== "team") return false
          await revokeGitHubRepositoryAccess(
            prisma,
            {
              delivery: receipt,
              disconnect: false,
              githubRepositoryIds: "all",
              ...(event.member ? { githubUserId: event.member.id } : {}),
            },
            input.provider,
          )
          return true
        }
        if (name === "team" && action.data.action === "removed_from_repository") {
          const event = teamRepositoryEvent.parse(payload)
          const repositoryId = event.repository?.id
          await revokeGitHubRepositoryAccess(
            prisma,
            {
              delivery: receipt,
              disconnect: false,
              githubRepositoryIds:
                repositoryId === null || repositoryId === undefined ? "all" : [repositoryId],
            },
            input.provider,
          )
          return true
        }
        if (name === "team" && action.data.action === "deleted") {
          teamDeletedEvent.parse(payload)
          await revokeGitHubRepositoryAccess(
            prisma,
            { delivery: receipt, disconnect: false, githubRepositoryIds: "all" },
            input.provider,
          )
          return true
        }
      }
      return false
    },
  }
}
