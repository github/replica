import type { Logger } from "pino"

import { getCopilotConnectionStatus } from "../../copilot-connection/get-copilot-connection-status/index.ts"
import { createReviewCommentLearningSource } from "../create-review-comment-learning-source/index.ts"
import { learningRunJob } from "../jobs/learning-run.ts"
import { recoverLearningRunsJob } from "../jobs/recover-learning-runs.ts"
import { redactReviewCommentJob } from "../jobs/redact-review-comment.ts"
import { prepareLearningStore } from "../prepare-learning-store/index.ts"
import { processLearningRun } from "../process-learning-run/index.ts"
import { processReviewCommentRedaction } from "../process-review-comment-redaction/index.ts"
import { readLearningConfiguration } from "../read-learning-configuration/index.ts"
import { createJobProcessor } from "../../../integrations/bullmq/create-job-processor/index.ts"
import { createJobQueue } from "../../../integrations/bullmq/create-job-queue/index.ts"
import { enqueueRecoverableJob } from "../../../integrations/bullmq/enqueue-recoverable-job/index.ts"
import { runLearningCommand } from "../../../integrations/learning/run-learning-command/index.ts"
import { withLearningExecutionLock } from "../../../integrations/postgres/with-learning-execution-lock/index.ts"
import { getCopilotConnectionState } from "../../../repositories/copilot-connection-states/get-copilot-connection-state/index.ts"
import { advanceCopilotConnectionState } from "../../../repositories/copilot-connection-states/advance-copilot-connection-state/index.ts"
import { lockCopilotConnectionState } from "../../../repositories/copilot-connection-states/lock-copilot-connection-state/index.ts"
import { recordCopilotCredentialRefusal } from "../../../repositories/copilot-connection-states/record-copilot-credential-refusal/index.ts"
import { getCopilotConnection } from "../../../repositories/copilot-connections/get-copilot-connection/index.ts"
import { claimLearningRun } from "../../../repositories/learning-runs/claim-learning-run/index.ts"
import { finishLearningRun } from "../../../repositories/learning-runs/finish-learning-run/index.ts"
import { getLearningRun } from "../../../repositories/learning-runs/get-learning-run/index.ts"
import { listQueuedLearningRuns } from "../../../repositories/learning-runs/list-queued-learning-runs/index.ts"
import { updateLearningRunProgress } from "../../../repositories/learning-runs/update-learning-run-progress/index.ts"
import { isEffectiveAdministrator } from "../../../repositories/memberships/is-effective-administrator/index.ts"
import { listDeletedReviewComments } from "../../../repositories/review-comments/list-deleted-review-comments/index.ts"
import { markReviewCommentLearningRedacted } from "../../../repositories/review-comments/mark-review-comment-learning-redacted/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { randomUUID } from "node:crypto"

export function createLearningJobProcessors(environment: NodeJS.ProcessEnv, logger: Logger) {
  let dependenciesPromise: ReturnType<typeof loadDependencies> | undefined
  function loadDependencies() {
    return (async () => {
      const configuration = await readLearningConfiguration(environment)
      const databaseUrl = environment.DATABASE_URL
      const hubOrigin = environment.HUB_APPLICATION_ORIGIN
      if (!databaseUrl || !hubOrigin) {
        throw new Error("DATABASE_URL and HUB_APPLICATION_ORIGIN are required for learning jobs.")
      }
      const { prisma } = await import("../../../integrations/prisma/index.ts")
      const source = createReviewCommentLearningSource(prisma, hubOrigin)
      return { configuration, databaseUrl, prisma, source }
    })()
  }
  function dependencies() {
    dependenciesPromise ??= loadDependencies()
    return dependenciesPromise
  }

  const run = createJobProcessor(learningRunJob, async ({ runId }) => {
    const { configuration, databaseUrl, prisma, source } = await dependencies()
    await processLearningRun(runId, {
      claim: (id, startedAt) => claimLearningRun(prisma, id, startedAt),
      capture: (repositoryId) => source.captureCompleteSnapshot({ repositoryId }),
      finish: (id, input) => finishLearningRun(prisma, id, input),
      getRun: (id) => getLearningRun(prisma, id),
      now: () => new Date(),
      isAdministrator: (membershipId) => isEffectiveAdministrator(prisma, membershipId),
      prepare: (repositoryId) =>
        prepareLearningStore({
          applicationRoot: process.cwd(),
          repositoryKey: repositoryId,
          repositoryScope: `github.com/repositories/${repositoryId}`,
          root: configuration.root,
          staticDirectories: configuration.staticDirectories,
        }),
      refuseCredential: async () => {
        const digest = configuration.copilotCredentialProvider.configurationDigest
        if (!digest) return
        await prisma.$transaction(async (transaction) => {
          const state = await lockCopilotConnectionState(transaction)
          const connection = await getCopilotConnection(transaction)
          if (
            !state ||
            !connection ||
            connection.credentialProvider !== configuration.copilotCredentialProvider.key ||
            connection.credentialDigest !== digest
          ) {
            return
          }
          if (
            !(await recordCopilotCredentialRefusal(transaction, {
              credentialDigest: digest,
              credentialProvider: configuration.copilotCredentialProvider.key,
              refusedAt: new Date(),
            }))
          ) {
            return
          }
          await advanceCopilotConnectionState(transaction)
          await createSecurityAudit(transaction, {
            actorMembershipId: connection.connectedByMembershipId,
            connectionId: connection.id,
            credentialProvider: configuration.copilotCredentialProvider.key,
            id: randomUUID(),
            phase: "denied",
            reason: "credential_refused",
            type: "copilot_connection",
          })
        })
      },
      runCommand: (arguments_, options) =>
        runLearningCommand(arguments_, {
          cliPath: configuration.cliPath,
          nodePath: configuration.nodePath,
          ...options,
        }),
      credential: async () => {
        const connection = await getCopilotConnection(prisma)
        const state = await getCopilotConnectionState(prisma)
        if (!state) return null
        const status = getCopilotConnectionStatus(
          connection
            ? {
                connectedBy: {
                  login: connection.connectedByMembership.user.profile?.login ?? null,
                  membershipId: connection.connectedByMembershipId,
                  name: connection.connectedByMembership.user.profile?.name ?? null,
                },
                credentialDigest: connection.credentialDigest,
                credentialProvider: connection.credentialProvider,
                verifiedAt: connection.verifiedAt,
              }
            : null,
          configuration.copilotCredentialProvider,
          connection
            ? await isEffectiveAdministrator(prisma, connection.connectedByMembershipId)
            : false,
          {
            credentialDigest: state.refusedCredentialDigest,
            credentialProvider: state.refusedCredentialProvider,
            refusedAt: state.refusedAt,
          },
        )
        return status.connected
          ? await configuration.copilotCredentialProvider.getCredential()
          : null
      },
      updateProgress: (id, input) => updateLearningRunProgress(prisma, id, input),
      withLock: (operation) => withLearningExecutionLock({ databaseUrl, run: operation }),
    })
  })

  const recover = createJobProcessor(recoverLearningRunsJob, async () => {
    const { databaseUrl, prisma } = await dependencies()
    const queue = createJobQueue({ name: "on-demand", databaseUrl, logger })
    try {
      for (const queued of await listQueuedLearningRuns(prisma)) {
        await enqueueRecoverableJob(
          queue,
          learningRunJob,
          { runId: queued.id },
          `learning-run-${queued.id}`,
        )
      }
      for (const comment of await listDeletedReviewComments(prisma)) {
        await enqueueRecoverableJob(
          queue,
          redactReviewCommentJob,
          {
            repositoryId: comment.thread.repositoryId,
            commentId: comment.publicId,
            actor: comment.learningRedactionActor ?? `human:${comment.authorLogin}`,
          },
          `learning-redact-${comment.thread.repositoryId}-${comment.publicId}`,
        )
      }
    } finally {
      await queue.close()
    }
  })

  const redact = createJobProcessor(redactReviewCommentJob, async (input) => {
    const { configuration, databaseUrl, prisma } = await dependencies()
    await processReviewCommentRedaction(input, {
      root: configuration.root,
      markComplete: (completed) => markReviewCommentLearningRedacted(prisma, completed),
      now: () => new Date(),
      prepare: (repositoryId) =>
        prepareLearningStore({
          applicationRoot: process.cwd(),
          repositoryKey: repositoryId,
          repositoryScope: `github.com/repositories/${repositoryId}`,
          root: configuration.root,
          staticDirectories: configuration.staticDirectories,
        }),
      runCommand: (arguments_, options) =>
        runLearningCommand(arguments_, {
          cliPath: configuration.cliPath,
          nodePath: configuration.nodePath,
          ...options,
        }),
      withLock: (operation) => withLearningExecutionLock({ databaseUrl, run: operation }),
    })
  })

  return { run, recover, redact }
}
