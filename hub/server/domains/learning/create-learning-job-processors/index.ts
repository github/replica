import { randomUUID } from "node:crypto"
import type { Logger } from "pino"

import { readGitHubAppConfiguration } from "../../authentication/read-github-app-configuration/index.ts"
import { resolveLocalSignInEnvironment } from "../../authentication/resolve-local-sign-in-environment/index.ts"
import { getCopilotConnectionStatus } from "../../copilot-connection/get-copilot-connection-status/index.ts"
import { ReviewCommentError } from "../../review-comments/errors.ts"
import { authorizeRepositoryAdministration } from "../authorize-repository-administration/index.ts"
import { createReviewCommentLearningSource } from "../create-review-comment-learning-source/index.ts"
import { deleteWithdrawnAgentScreenshots } from "../delete-withdrawn-agent-screenshots/index.ts"
import { getLearningRepositoryScope } from "../get-learning-repository-scope/index.ts"
import { deleteAgentScreenshotsJob } from "../jobs/delete-agent-screenshots.ts"
import { learningRunJob } from "../jobs/learning-run.ts"
import { automaticLearningRunPriority } from "../jobs/priorities.ts"
import { recoverLearningRunsJob } from "../jobs/recover-learning-runs.ts"
import { redactReviewCommentJob } from "../jobs/redact-review-comment.ts"
import { scheduleLearningRunsJob } from "../jobs/schedule-learning-runs.ts"
import { scoreAppliedLearningsJob } from "../jobs/score-applied-learnings.ts"
import { learningStoreArguments } from "../learning-store-arguments/index.ts"
import { prepareLearningStore } from "../prepare-learning-store/index.ts"
import { processLearningRun } from "../process-learning-run/index.ts"
import { processReviewCommentRedaction } from "../process-review-comment-redaction/index.ts"
import { redactLegacyReviewComment } from "../redact-legacy-review-comment/index.ts"
import { recoverLearningRunJobs } from "../recover-learning-run-jobs/index.ts"
import { reconcileLearningDecisionOperation } from "../reconcile-learning-decision-operation/index.ts"
import { recordFinishedLearningRun } from "../record-finished-learning-run/index.ts"
import { readAutomaticLearningRunsEnabled } from "../read-automatic-learning-runs-enabled/index.ts"
import { readLearningConfiguration } from "../read-learning-configuration/index.ts"
import { scheduleLearningRuns } from "../schedule-learning-runs/index.ts"
import { scoreAppliedLearnings } from "../score-applied-learnings/index.ts"
import { createConfiguredArtifactStorage } from "../../artifacts/create-configured-artifact-storage/index.ts"
import { createJobProcessor } from "../../../integrations/bullmq/create-job-processor/index.ts"
import { createJobQueue } from "../../../integrations/bullmq/create-job-queue/index.ts"
import { enqueueRecoverableJob } from "../../../integrations/bullmq/enqueue-recoverable-job/index.ts"
import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { runLearningCommand } from "../../../integrations/learning/run-learning-command/index.ts"
import { LearningCommandError } from "../../../integrations/learning/run-learning-command/errors.ts"
import { CopilotCredentialError } from "../../../integrations/github/create-installation-access-token/errors.ts"
import { createGitHubActionsClient } from "../../../integrations/github/create-github-actions-client/index.ts"
import { GitHubCommitLookupError } from "../../../integrations/github/errors.ts"
import { withLearningExecutionLock } from "../../../integrations/postgres/with-learning-execution-lock/index.ts"
import { deleteAgentScreenshot } from "../../../repositories/agent-screenshots/delete-agent-screenshot/index.ts"
import { findConsentedAgentScreenshots } from "../../../repositories/agent-screenshots/find-consented-agent-screenshots/index.ts"
import { listAgentScreenshotGrants } from "../../../repositories/agent-screenshots/list-agent-screenshot-grants/index.ts"
import { listGrantAgentScreenshots } from "../../../repositories/agent-screenshots/list-grant-agent-screenshots/index.ts"
import { getRepositoryEvaluationSetting } from "../../../repositories/evaluation-settings/get-repository-evaluation-setting/index.ts"
import { initializeEvaluationSetting } from "../../../repositories/evaluation-settings/initialize-evaluation-setting/index.ts"
import { finishLearningEvaluationRun } from "../../../repositories/learning-evaluation-runs/finish-learning-evaluation-run/index.ts"
import { startLearningEvaluationRun } from "../../../repositories/learning-evaluation-runs/start-learning-evaluation-run/index.ts"
import { sumLearningEvaluationCredits } from "../../../repositories/learning-evaluation-runs/sum-learning-evaluation-credits/index.ts"
import { deleteExpiredLearningScoreRequests } from "../../../repositories/learning-score-requests/delete-expired-learning-score-requests/index.ts"
import { deleteLearningScoreRequest } from "../../../repositories/learning-score-requests/delete-learning-score-request/index.ts"
import { findLearningScoreRequest } from "../../../repositories/learning-score-requests/find-learning-score-request/index.ts"
import { listReadyLearningScoreRequests } from "../../../repositories/learning-score-requests/list-ready-learning-score-requests/index.ts"
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
import { findRepositoryGitHubId } from "../../../repositories/repository-access/find-repository-github-id/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { startOfUtcMonth } from "../../../utils/start-of-utc-month/index.ts"

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

  // Learning runs and scoring both fetch a fresh Copilot credential and record a refusal
  // only against the connection that credential came from, so a newer connection made
  // meanwhile is never marked as refused.
  function createCopilotCredentialSession() {
    let credentialSnapshot:
      | {
          connectionId: string
          generation: bigint
          credentialDigest: string
          credentialProvider: string
        }
      | undefined
    return {
      credential: async () => {
        const { configuration, prisma } = await dependencies()
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
      refuseCredential: async () => {
        if (!credentialSnapshot) return
        const snapshot = credentialSnapshot
        const { prisma } = await dependencies()
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
    }
  }

  async function processRun(runId: string, scheduled: boolean) {
    const { configuration, databaseUrl, prisma, source } = await dependencies()
    const stored = await getLearningRun(prisma, runId)
    if (!stored || stored.scheduled !== scheduled) return
    const copilot = createCopilotCredentialSession()
    return await processLearningRun(runId, {
      expectedScheduled: scheduled,
      claim: (id, startedAt, expectedScheduled) =>
        claimLearningRun(prisma, id, startedAt, expectedScheduled),
      capture: (repositoryId) => source.captureCompleteSnapshot({ repositoryId }),
      finish: (id, input) =>
        recordFinishedLearningRun(prisma, id, (transaction) =>
          finishLearningRun(transaction, id, input),
        ),
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
          learningDatabaseUrl: configuration.learningDatabaseUrl,
          repositoryKey: repositoryId,
          repositoryScope: await getLearningRepositoryScope(prisma, repositoryId),
          root: configuration.root,
          staticDirectories: configuration.staticDirectories,
        }),
      refuseCredential: copilot.refuseCredential,
      runCommand: (arguments_, options) =>
        runLearningCommand(arguments_, {
          cliPath: configuration.cliPath,
          learningDatabaseUrl: configuration.learningDatabaseUrl,
          nodePath: configuration.nodePath,
          ...options,
        }),
      credential: copilot.credential,
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
      for (const screenshots of await listAgentScreenshotGrants(prisma)) {
        if (screenshots.active) continue
        await enqueueRecoverableJob(
          onDemandQueue,
          deleteAgentScreenshotsJob,
          { repositoryId: screenshots.repositoryId, grantId: screenshots.grantId },
          `learning-screenshots-${screenshots.repositoryId}-${screenshots.grantId}`,
        )
      }
      // Agents can report usage before or after the Build for that commit finishes, so
      // requests wait here until both exist. Unbuilt ones are dropped after 30 days.
      await deleteExpiredLearningScoreRequests(
        prisma,
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      )
      // Scoring is automatic work, so it waits behind anything a person asked for.
      for (const request of await listReadyLearningScoreRequests(prisma)) {
        await enqueueRecoverableJob(
          scheduledQueue,
          scoreAppliedLearningsJob,
          request,
          `learning-score-${request.repositoryId}-${request.commitSha}`,
          { priority: automaticLearningRunPriority },
        )
      }
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
                  decision: operation.decision as
                    "accept" | "reject" | "retire" | "edit" | "reinstate",
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
                learningDatabaseUrl: configuration.learningDatabaseUrl,
                repositoryKey: repositoryId,
                repositoryScope: await getLearningRepositoryScope(prisma, repositoryId),
                root: configuration.root,
                staticDirectories: configuration.staticDirectories,
              }),
            runCommand: (arguments_, options) =>
              runLearningCommand(arguments_, {
                cliPath: configuration.cliPath,
                learningDatabaseUrl: configuration.learningDatabaseUrl,
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
          const failed = await recordFinishedLearningRun(prisma, runId, (transaction) =>
            failScheduledLearningRunEnqueue(transaction, runId, new Date()),
          )
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
      learningDatabaseUrl: configuration.learningDatabaseUrl,
      root: configuration.root,
      markComplete: (completed) => markReviewCommentLearningRedacted(prisma, completed),
      now: () => new Date(),
      prepare: async (repositoryId) => {
        const repository = await findRepositoryGitHubId(prisma, repositoryId)
        if (!repository) throw new Error("The repository for learning redaction no longer exists.")
        if (repository.githubRepositoryId == null || repository.githubRepositoryId <= 0n)
          return null
        return await prepareLearningStore({
          applicationRoot: process.cwd(),
          learningDatabaseUrl: configuration.learningDatabaseUrl,
          repositoryKey: repositoryId,
          repositoryScope: `github.com/repositories/${repository.githubRepositoryId}`,
          root: configuration.root,
          staticDirectories: configuration.staticDirectories,
        })
      },
      redactLegacy: (request, options) =>
        redactLegacyReviewComment(request, { ...configuration, ...options }),
      runCommand: (arguments_, options) =>
        runLearningCommand(arguments_, {
          cliPath: configuration.cliPath,
          learningDatabaseUrl: configuration.learningDatabaseUrl,
          nodePath: configuration.nodePath,
          ...options,
        }),
      withLock: (operation) => withLearningExecutionLock({ databaseUrl, run: operation }),
    })
  })

  let storagePromise: ReturnType<typeof createConfiguredArtifactStorage> | undefined
  // Storage opens only when there is an image to delete, and a failed open is retried.
  function artifactStorage() {
    storagePromise ??= createConfiguredArtifactStorage(
      resolveLocalSignInEnvironment(environment),
    ).catch((error: unknown) => {
      storagePromise = undefined
      throw error
    })
    return storagePromise
  }
  const deleteScreenshots = createJobProcessor(deleteAgentScreenshotsJob, async (input) => {
    const { prisma } = await databaseDependencies()
    await deleteWithdrawnAgentScreenshots({
      activeGrantId: async () =>
        (await getRepositoryEvaluationSetting(prisma, input.repositoryId))?.screenshotGrantId ??
        null,
      deleteRecord: (id) => deleteAgentScreenshot(prisma, id),
      grantId: input.grantId,
      list: () => listGrantAgentScreenshots(prisma, input),
      storage: { delete: async (key) => (await artifactStorage()).delete(key) },
    })
  })

  const score = createJobProcessor(scoreAppliedLearningsJob, async (request, context) => {
    const { configuration, databaseUrl, prisma } = await dependencies()
    const repository = { repositoryId: request.repositoryId, commitSha: request.commitSha }
    // Read before the store's usage, so a report that lands while scoring runs raises the
    // revision and keeps its request for another pass.
    const pending = await findLearningScoreRequest(prisma, repository)
    if (!pending) return
    const copilot = createCopilotCredentialSession()
    try {
      const result = await scoreAppliedLearnings({
        commitSha: request.commitSha,
        credential: copilot.credential,
        deleteRequest: () =>
          deleteLearningScoreRequest(prisma, { ...repository, revision: pending.revision }),
        finish: (runId, input) => finishLearningEvaluationRun(prisma, runId, input),
        hasPendingUserRun: () => hasPendingUserLearningRun(prisma),
        // Scoring needs the store's evaluation grant, which a repository turned on before
        // grants existed gets on its next settings save, and a repository Hub can still
        // reach.
        isEnabled: () =>
          prisma.$transaction(async (transaction) => {
            await lockGitHubRepositoryAccessState(transaction)
            const setting = await getRepositoryEvaluationSetting(transaction, request.repositoryId)
            return (
              Boolean(setting?.enabled && setting.evaluationGrantId) &&
              (await isLearningRunRepositoryAvailable(transaction, request.repositoryId, true))
            )
          }),
        now: () => new Date(),
        prepare: async () =>
          learningStoreArguments(
            await prepareLearningStore({
              applicationRoot: process.cwd(),
              learningDatabaseUrl: configuration.learningDatabaseUrl,
              repositoryKey: request.repositoryId,
              repositoryScope: await getLearningRepositoryScope(prisma, request.repositoryId),
              root: configuration.root,
              staticDirectories: configuration.staticDirectories,
            }),
          ),
        readDiff: async () => {
          const credentials = readGitHubAppConfiguration(
            resolveLocalSignInEnvironment(environment),
          ).appCredentials
          const githubRepositoryId = (await findRepositoryGitHubId(prisma, request.repositoryId))
            ?.githubRepositoryId
          if (!credentials || !githubRepositoryId) return null
          try {
            return await createGitHubActionsClient({
              appId: credentials.appId,
              installationId: credentials.installationId,
              privateKey: credentials.privateKey,
              githubRepositoryId: Number(githubRepositoryId),
            }).getCommitDiff(request.commitSha)
          } catch (error) {
            // A commit GitHub no longer has is scored on what remains.
            if (
              error instanceof GitHubCommitLookupError &&
              (error.statusCode === 404 || error.statusCode === 422)
            )
              return null
            throw error
          }
        },
        readScreenshot: async (sha256) => {
          const consented = await findConsentedAgentScreenshots(prisma, {
            repositoryId: request.repositoryId,
            sha256s: [sha256],
          })
          const storageKey = consented?.storageKeys.get(sha256)
          if (!storageKey) return null
          const read = await (await artifactStorage()).read(storageKey)
          if (read.status === "ok") return read.bytes
          if (read.status === "not-found") return null
          // An outage would change the score, so the attempt is retried later instead.
          throw new Error(`Hub could not read an agent screenshot: ${read.status}.`)
        },
        refuseCredential: copilot.refuseCredential,
        runCommand: (arguments_, options) =>
          runLearningCommand(arguments_, {
            cliPath: configuration.cliPath,
            learningDatabaseUrl: configuration.learningDatabaseUrl,
            nodePath: configuration.nodePath,
            ...options,
          }),
        start: (usedLearningId) =>
          startLearningEvaluationRun(prisma, {
            repositoryId: request.repositoryId,
            usedLearningId,
          }),
        withinBudget: async () => {
          const budget = (await initializeEvaluationSetting(prisma)).monthlyBudgetCredits
          const used = await sumLearningEvaluationCredits(prisma, startOfUtcMonth(new Date()))
          return used ? used.lessThan(budget) : budget.greaterThan(0)
        },
        withLock: (operation) => withLearningExecutionLock({ databaseUrl, run: operation }),
      })
      if (result === "deferred") return await context.defer(30_000)
      if (result === "paused")
        logger.info(
          repository,
          "Applied learning scoring is paused until Copilot or budget returns",
        )
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Another learning operation is still running."
      )
        return await context.defer(30_000)
      throw error
    }
  })

  return { run, scheduledRun, recover, redact, schedule, deleteScreenshots, score }
}
