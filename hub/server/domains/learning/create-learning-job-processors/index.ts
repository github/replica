import { randomUUID } from "node:crypto"
import type { Logger } from "pino"

import { resolveLocalSignInEnvironment } from "../../authentication/resolve-local-sign-in-environment/index.ts"
import { getCopilotConnectionStatus } from "../../copilot-connection/get-copilot-connection-status/index.ts"
import { ReviewCommentError } from "../../review-comments/errors.ts"
import { authorizeRepositoryAdministration } from "../authorize-repository-administration/index.ts"
import { createReviewCommentLearningSource } from "../create-review-comment-learning-source/index.ts"
import { getLearningRepositoryScope } from "../get-learning-repository-scope/index.ts"
import { learningRunJob } from "../jobs/learning-run.ts"
import { automaticLearningRunPriority } from "../jobs/priorities.ts"
import { recoverLearningRunsJob } from "../jobs/recover-learning-runs.ts"
import { redactReviewCommentJob } from "../jobs/redact-review-comment.ts"
import { scheduleLearningRunsJob } from "../jobs/schedule-learning-runs.ts"
import { prepareLearningStore } from "../prepare-learning-store/index.ts"
import { processLearningRun } from "../process-learning-run/index.ts"
import { processReviewCommentRedaction } from "../process-review-comment-redaction/index.ts"
import { recoverLearningRunJobs } from "../recover-learning-run-jobs/index.ts"
import { reconcileLearningDecisionOperation } from "../reconcile-learning-decision-operation/index.ts"
import { readAutomaticLearningRunsEnabled } from "../read-automatic-learning-runs-enabled/index.ts"
import { readLearningConfiguration } from "../read-learning-configuration/index.ts"
import { scheduleLearningRuns } from "../schedule-learning-runs/index.ts"
import { createJobProcessor } from "../../../integrations/bullmq/create-job-processor/index.ts"
import { createJobQueue } from "../../../integrations/bullmq/create-job-queue/index.ts"
import { enqueueRecoverableJob } from "../../../integrations/bullmq/enqueue-recoverable-job/index.ts"
import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { runLearningCommand } from "../../../integrations/learning/run-learning-command/index.ts"
import { LearningCommandError } from "../../../integrations/learning/run-learning-command/errors.ts"
import { CopilotCredentialError } from "../../../integrations/github/create-installation-access-token/errors.ts"
import { withLearningExecutionLock } from "../../../integrations/postgres/with-learning-execution-lock/index.ts"
import { getCopilotConnectionState } from "../../../repositories/copilot-connection-states/get-copilot-connection-state/index.ts"
import { advanceCopilotConnectionState } from "../../../repositories/copilot-connection-states/advance-copilot-connection-state/index.ts"
import { lockCopilotConnectionState } from "../../../repositories/copilot-connection-states/lock-copilot-connection-state/index.ts"
import { recordCopilotCredentialRefusal } from "../../../repositories/copilot-connection-states/record-copilot-credential-refusal/index.ts"
import { getCopilotConnection } from "../../../repositories/copilot-connections/get-copilot-connection/index.ts"
import { claimLearningRun } from "../../../repositories/learning-runs/claim-learning-run/index.ts"
import { createLearningRun } from "../../../repositories/learning-runs/create-learning-run/index.ts"
import { deleteExpiredLearningRuns } from "../../../repositories/learning-runs/delete-expired-learning-runs/index.ts"
import { failScheduledLearningRunEnqueue } from "../../../repositories/learning-runs/fail-scheduled-learning-run-enqueue/index.ts"
import { finishLearningRun } from "../../../repositories/learning-runs/finish-learning-run/index.ts"
import { getLearningRun } from "../../../repositories/learning-runs/get-learning-run/index.ts"
import { hasPendingUserLearningRun } from "../../../repositories/learning-runs/has-pending-user-learning-run/index.ts"
import { isLearningRunRepositoryAvailable } from "../../../repositories/learning-runs/is-learning-run-repository-available/index.ts"
import { listDueLearningRepositories } from "../../../repositories/learning-runs/list-due-learning-repositories/index.ts"
import { listQueuedLearningRuns } from "../../../repositories/learning-runs/list-queued-learning-runs/index.ts"
import { deleteLearningDecisionOperation } from "../../../repositories/learning-decision-operations/delete-learning-decision-operation/index.ts"
import { listLearningDecisionOperations } from "../../../repositories/learning-decision-operations/list-learning-decision-operations/index.ts"
import { updateLearningRunProgress } from "../../../repositories/learning-runs/update-learning-run-progress/index.ts"
import { isEffectiveAdministrator } from "../../../repositories/memberships/is-effective-administrator/index.ts"
import { lockGitHubRepositoryAccessState } from "../../../repositories/github-repository-access-states/lock-github-repository-access-state/index.ts"
import { listDeletedReviewComments } from "../../../repositories/review-comments/list-deleted-review-comments/index.ts"
import { markReviewCommentLearningRedacted } from "../../../repositories/review-comments/mark-review-comment-learning-redacted/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"

export function createLearningJobProcessors(environment: NodeJS.ProcessEnv, logger: Logger) {
  let databaseDependenciesPromise:
    | Promise<{
        databaseUrl: string
        prisma: PrismaClient
      }>
    | undefined
  function databaseDependencies() {
    databaseDependenciesPromise ??= (async () => {
      const resolvedEnvironment = resolveLocalSignInEnvironment(environment)
      const databaseUrl = resolvedEnvironment.DATABASE_URL
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for learning jobs.")
      }
      const { prisma } = await import("../../../integrations/prisma/index.ts")
      return { databaseUrl, prisma }
    })()
    return databaseDependenciesPromise
  }

  let dependenciesPromise: ReturnType<typeof loadDependencies> | undefined
  function loadDependencies() {
    return (async () => {
      const resolvedEnvironment = resolveLocalSignInEnvironment(environment)
      const configuration = await readLearningConfiguration(resolvedEnvironment)
      const hubOrigin = resolvedEnvironment.HUB_APPLICATION_ORIGIN
      if (!hubOrigin) {
        throw new Error("HUB_APPLICATION_ORIGIN is required for learning jobs.")
      }
      const { databaseUrl, prisma } = await databaseDependencies()
      const source = createReviewCommentLearningSource(prisma, hubOrigin)
      return { configuration, databaseUrl, prisma, source }
    })()
  }
  function dependencies() {
    dependenciesPromise ??= loadDependencies()
    return dependenciesPromise
  }

  async function copilotUsable() {
    const { configuration, prisma } = await dependencies()
    const connection = await getCopilotConnection(prisma)
    const state = await getCopilotConnectionState(prisma)
    if (!state) return false
    return getCopilotConnectionStatus(
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
    ).connected
  }

  async function processRun(runId: string, scheduled: boolean) {
    const { configuration, databaseUrl, prisma, source } = await dependencies()
    const stored = await getLearningRun(prisma, runId)
    if (!stored || stored.scheduled !== scheduled) return
    let credentialSnapshot:
      | {
          connectionId: string
          generation: bigint
          credentialDigest: string
          credentialProvider: string
        }
      | undefined
    return await processLearningRun(runId, {
      expectedScheduled: scheduled,
      claim: (id, startedAt, expectedScheduled) =>
        claimLearningRun(prisma, id, startedAt, expectedScheduled),
      capture: (repositoryId) => source.captureCompleteSnapshot({ repositoryId }),
      finish: (id, input) => finishLearningRun(prisma, id, input),
      getRun: (id) => getLearningRun(prisma, id),
      hasPendingUserRun: () => hasPendingUserLearningRun(prisma),
      isRepositoryAvailable: (repositoryId) =>
        prisma.$transaction(async (transaction) => {
          await lockGitHubRepositoryAccessState(transaction)
          return isLearningRunRepositoryAvailable(transaction, repositoryId, true)
        }),
      now: () => new Date(),
      authorizeRepositoryAdministration: (membershipId, repositoryId) =>
        authorizeRepositoryAdministration(prisma, { membershipId, repositoryId }),
      prepare: async (repositoryId) =>
        prepareLearningStore({
          applicationRoot: process.cwd(),
          repositoryKey: repositoryId,
          repositoryScope: await getLearningRepositoryScope(prisma, repositoryId),
          root: configuration.root,
          staticDirectories: configuration.staticDirectories,
        }),
      refuseCredential: async () => {
        if (!credentialSnapshot) return
        const snapshot = credentialSnapshot
        await prisma.$transaction(async (transaction) => {
          const state = await lockCopilotConnectionState(transaction)
          const connection = await getCopilotConnection(transaction)
          if (
            !state ||
            !connection ||
            state.generation !== snapshot.generation ||
            connection.id !== snapshot.connectionId ||
            connection.credentialProvider !== snapshot.credentialProvider ||
            connection.credentialDigest !== snapshot.credentialDigest
          ) {
            return
          }
          if (
            !(await recordCopilotCredentialRefusal(transaction, {
              credentialDigest: snapshot.credentialDigest,
              credentialProvider: snapshot.credentialProvider,
              refusedAt: new Date(),
            }))
          ) {
            return
          }
          await advanceCopilotConnectionState(transaction)
          await createSecurityAudit(transaction, {
            actorMembershipId: connection.connectedByMembershipId,
            connectionId: connection.id,
            credentialProvider: snapshot.credentialProvider,
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
        if (!status.connected || !connection) return null
        credentialSnapshot = {
          connectionId: connection.id,
          generation: state.generation,
          credentialDigest: connection.credentialDigest,
          credentialProvider: connection.credentialProvider,
        }
        try {
          return await configuration.copilotCredentialProvider.getCredential()
        } catch (error) {
          if (
            error instanceof CopilotCredentialError &&
            (error.code === "installation_revoked" || error.code === "permission_denied")
          ) {
            throw new LearningCommandError(error.code, error.message, { cause: error })
          }
          throw error
        }
      },
      updateProgress: (id, input) => updateLearningRunProgress(prisma, id, input),
      withLock: (operation) => withLearningExecutionLock({ databaseUrl, run: operation }),
    })
  }

  const run = createJobProcessor(learningRunJob, async ({ runId }, context) => {
    if ((await processRun(runId, false)) === "deferred") await context.defer(30_000)
  })
  const scheduledRun = createJobProcessor(learningRunJob, async ({ runId }, context) => {
    if ((await processRun(runId, true)) === "deferred") await context.defer(30_000)
  })

  const recover = createJobProcessor(recoverLearningRunsJob, async () => {
    const { configuration, databaseUrl, prisma } = await dependencies()
    const onDemandQueue = createJobQueue({ name: "on-demand", databaseUrl, logger })
    const scheduledQueue = createJobQueue({ name: "scheduled", databaseUrl, logger })
    try {
      await recoverLearningRunJobs({
        list: () => listQueuedLearningRuns(prisma),
        enqueueOnDemand: (runId) =>
          enqueueRecoverableJob(onDemandQueue, learningRunJob, { runId }, `learning-run-${runId}`),
        enqueueScheduled: (runId) =>
          enqueueRecoverableJob(
            scheduledQueue,
            learningRunJob,
            { runId },
            `learning-run-${runId}`,
            { priority: automaticLearningRunPriority },
          ),
      })
      let redactionCursor: { deletedAt: Date; id: string } | undefined
      do {
        const comments = await listDeletedReviewComments(prisma, {
          ...(redactionCursor ? { after: redactionCursor } : {}),
        })
        for (const comment of comments) {
          await enqueueRecoverableJob(
            onDemandQueue,
            redactReviewCommentJob,
            {
              repositoryId: comment.thread.repositoryId,
              commentId: comment.publicId,
              actor: comment.learningRedactionActor ?? `human:${comment.authorLogin}`,
            },
            `learning-redact-${comment.thread.repositoryId}-${comment.publicId}`,
          )
        }
        const last = comments.at(-1)
        redactionCursor =
          comments.length === 100 && last?.deletedAt
            ? { deletedAt: last.deletedAt, id: last.id }
            : undefined
      } while (redactionCursor)
      for (const operation of await listLearningDecisionOperations(prisma)) {
        try {
          await reconcileLearningDecisionOperation(operation, {
            finish: (input) =>
              prisma.$transaction(async (transaction) => {
                const claimed = await deleteLearningDecisionOperation(
                  transaction,
                  input.operationId,
                )
                if (claimed.count !== 1) return
                await createSecurityAudit(transaction, {
                  id: input.auditId,
                  type: "learning_decision",
                  actorMembershipId: operation.actorMembershipId,
                  decision: operation.decision as "accept" | "reject" | "retire",
                  learningId: operation.learningId,
                  operationId: operation.id,
                  outcome: input.outcome,
                  ...(input.reason ? { reason: input.reason } : {}),
                  repositoryId: operation.repositoryId,
                })
              }),
            prepare: async (repositoryId) =>
              prepareLearningStore({
                applicationRoot: process.cwd(),
                repositoryKey: repositoryId,
                repositoryScope: await getLearningRepositoryScope(prisma, repositoryId),
                root: configuration.root,
                staticDirectories: configuration.staticDirectories,
              }),
            runCommand: (arguments_, options) =>
              runLearningCommand(arguments_, {
                cliPath: configuration.cliPath,
                nodePath: configuration.nodePath,
                ...options,
              }),
            withLock: (operation_) => withLearningExecutionLock({ databaseUrl, run: operation_ }),
          })
        } catch (error) {
          logger.warn(
            {
              errorType: error instanceof Error ? error.name : "UnknownError",
              operationId: operation.id,
              repositoryId: operation.repositoryId,
            },
            "Pending learning decision reconciliation failed",
          )
        }
      }
    } finally {
      await Promise.all([onDemandQueue.close(), scheduledQueue.close()])
    }
  })

  const schedule = createJobProcessor(scheduleLearningRunsJob, async () => {
    const automaticEnabled = readAutomaticLearningRunsEnabled(environment)
    if (!automaticEnabled) {
      const { prisma } = await databaseDependencies()
      return await scheduleLearningRuns({
        automaticEnabled,
        deleteExpired: (cutoff) => deleteExpiredLearningRuns(prisma, cutoff),
        now: () => new Date(),
      })
    }
    const { databaseUrl, prisma, source } = await dependencies()
    const queue = createJobQueue({ name: "scheduled", databaseUrl, logger })
    try {
      return await scheduleLearningRuns({
        automaticEnabled: true,
        copilotUsable,
        deleteExpired: (cutoff) => deleteExpiredLearningRuns(prisma, cutoff),
        listDue: () =>
          prisma.$transaction(async (transaction) => {
            await lockGitHubRepositoryAccessState(transaction)
            return listDueLearningRepositories(transaction, {
              requireGitHubId: true,
            })
          }),
        capture: async (repositoryId) => {
          try {
            return await source.captureCompleteSnapshot({ repositoryId })
          } catch (error) {
            if (error instanceof ReviewCommentError && error.code === "not_found") return null
            throw error
          }
        },
        create: (input) =>
          prisma.$transaction(async (transaction) => {
            await lockGitHubRepositoryAccessState(transaction)
            if (!(await isLearningRunRepositoryAvailable(transaction, input.repositoryId, true))) {
              return null
            }
            return createLearningRun(transaction, input)
          }),
        enqueue: (runId) =>
          enqueueRecoverableJob(queue, learningRunJob, { runId }, `learning-run-${runId}`, {
            priority: automaticLearningRunPriority,
          }),
        fail: async (runId, error) => {
          const failed = await failScheduledLearningRunEnqueue(prisma, runId, new Date())
          if (failed.count === 0) return
          logger.error(
            {
              errorType: error instanceof Error ? error.name : "UnknownError",
              runId,
            },
            "Scheduled learning run enqueue failed",
          )
        },
        now: () => new Date(),
        reportRepositoryFailure: ({ repositoryId, errorType }) => {
          logger.warn({ repositoryId, errorType }, "Scheduled learning repository discovery failed")
        },
      })
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
      prepare: async (repositoryId) =>
        prepareLearningStore({
          applicationRoot: process.cwd(),
          repositoryKey: repositoryId,
          repositoryScope: await getLearningRepositoryScope(prisma, repositoryId),
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

  return { run, scheduledRun, recover, redact, schedule }
}
