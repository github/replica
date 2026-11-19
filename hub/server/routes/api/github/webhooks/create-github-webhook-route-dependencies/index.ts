import { z } from "zod"

import type { GitHubWorkflowRunJob } from "../../../../../domains/github-builds/get-github-workflow-run-job-definition/index.ts"
import { replicaWorkflowPath } from "../../../../../domains/github-builds/constants.ts"
import { revokeGitHubRepositoryAccess } from "../../../../../domains/admission/revoke-github-repository-access/index.ts"
import { recordGitHubBranchDeletion } from "../../../../../domains/prototypes/record-github-branch-deletion/index.ts"
import { prisma } from "../../../../../integrations/prisma/index.ts"
import { claimGitHubWebhookDelivery } from "../../../../../repositories/github-webhook-deliveries/claim-github-webhook-delivery/index.ts"
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
const workflowRunEvent = z.looseObject({
  action: z.enum(["requested", "in_progress", "completed"]),
  repository: z.looseObject({ id: githubId }),
  workflow_run: z.looseObject({ id: githubId, path: z.string() }),
})
const workflowJobEvent = z.looseObject({
  action: z.literal("completed"),
  repository: z.looseObject({ id: githubId }),
  workflow_job: z.looseObject({ run_id: githubId }),
})
const teamRepositoryPermissionEvent = z.looseObject({
  action: z.literal("edited"),
  changes: z.looseObject({ repository: z.looseObject({}) }),
  repository: z.looseObject({ id: githubId }),
  team,
})
const teamDeletedEvent = z.looseObject({
  action: z.literal("deleted"),
  team,
})
const branchDeletionEvent = z.looseObject({
  ref_type: z.enum(["branch", "tag"]),
  ref: z.string().min(1).max(255),
  repository: z.looseObject({ id: githubId }),
})
const pushEvent = z.looseObject({
  deleted: z.boolean(),
  before: z.unknown().optional(),
  ref: z.string().min(1).max(266),
  repository: z.looseObject({ id: githubId }),
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
  /** Enqueues idempotently by key, so a redelivered event cannot import twice. */
  enqueueWorkflowRunImport?: (job: GitHubWorkflowRunJob, key: string) => Promise<unknown>
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
      if (name === "delete" || name === "push") {
        let branchName: string | undefined
        let githubRepositoryId: number
        let deletedHeadSha: string | undefined
        if (name === "delete") {
          const event = branchDeletionEvent.safeParse(payload)
          if (!event.success) return false
          githubRepositoryId = event.data.repository.id
          if (event.data.ref_type === "branch") branchName = event.data.ref
        } else {
          const event = pushEvent.safeParse(payload)
          if (!event.success) return false
          githubRepositoryId = event.data.repository.id
          if (event.data.deleted && event.data.ref.startsWith("refs/heads/")) {
            branchName = event.data.ref.slice("refs/heads/".length)
            if (!branchName) return false
            const { before } = event.data
            if (typeof before === "string" && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(before)) {
              deletedHeadSha = before
            }
          }
        }
        if (!branchName) {
          // Acknowledge unrelated pushes and tag deletions so recovery need not resend them.
          await claimGitHubWebhookDelivery(prisma, receipt)
          return true
        }
        await recordGitHubBranchDeletion(prisma, {
          githubRepositoryId,
          branchName,
          deletedHeadSha,
          delivery: receipt,
        })
        return true
      }
      const action = webhookAction.safeParse(payload)
      if (!action.success) {
        if (name === "membership" || name === "team") {
          throw new Error("Invalid GitHub team webhook event.")
        }
        return false
      }
      if (name === "workflow_run" || name === "workflow_job") {
        if (!input.enqueueWorkflowRunImport) return false
        let job: GitHubWorkflowRunJob
        if (name === "workflow_run") {
          const event = workflowRunEvent.safeParse(payload)
          if (
            !event.success ||
            event.data.workflow_run.path.split("@")[0] !== replicaWorkflowPath
          ) {
            return false
          }
          job = { githubRepositoryId: event.data.repository.id, runId: event.data.workflow_run.id }
        } else {
          // Job events let the dist import as soon as its job ends, before screenshots finish.
          const event = workflowJobEvent.safeParse(payload)
          if (!event.success) return false
          job = {
            githubRepositoryId: event.data.repository.id,
            runId: event.data.workflow_job.run_id,
          }
        }
        // Enqueue before recording receipt so a failed enqueue can be redelivered.
        await input.enqueueWorkflowRunImport(job, delivery.id)
        await claimGitHubWebhookDelivery(prisma, receipt)
        return true
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
        if (name === "team" && action.data.action === "edited") {
          const event = teamRepositoryPermissionEvent.safeParse(payload)
          if (!event.success) return false
          await revokeGitHubRepositoryAccess(
            prisma,
            {
              delivery: receipt,
              disconnect: false,
              githubRepositoryIds: [event.data.repository.id],
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
