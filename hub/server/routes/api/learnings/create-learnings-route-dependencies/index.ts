import { randomUUID } from "node:crypto"
import type { Logger } from "pino"

import type { Prisma } from "../../../../generated/prisma/client.ts"
import { getCopilotConnectionStatus } from "../../../../domains/copilot-connection/get-copilot-connection-status/index.ts"
import { ReviewCommentError } from "../../../../domains/review-comments/errors.ts"
import { executeLearningDecision } from "../../../../domains/learning/execute-learning-decision/index.ts"
import { createReviewCommentLearningSource } from "../../../../domains/learning/create-review-comment-learning-source/index.ts"
import { getLearningHistory } from "../../../../domains/learning/get-learning-history/index.ts"
import { recordFinishedLearningRun } from "../../../../domains/learning/record-finished-learning-run/index.ts"
import { getLearningOverview } from "../../../../domains/learning/get-learning-overview/index.ts"
import { getLearningRepositoryScope } from "../../../../domains/learning/get-learning-repository-scope/index.ts"
import { readShareableLearnings } from "../../../../domains/learning/read-shareable-learnings/index.ts"
import { learningRunJob } from "../../../../domains/learning/jobs/learning-run.ts"
import { redactReviewCommentJob } from "../../../../domains/learning/jobs/redact-review-comment.ts"
import type { ReviewCommentLearningSource } from "../../../../domains/learning/review-comment-learning-source/types.ts"
import { readLearningConfiguration } from "../../../../domains/learning/read-learning-configuration/index.ts"
import { changeScreenshotConsent } from "../../../../domains/learning/change-screenshot-consent/index.ts"
import { deleteAgentScreenshotsJob } from "../../../../domains/learning/jobs/delete-agent-screenshots.ts"
import { getRepositoryEvaluationSetting } from "../../../../repositories/evaluation-settings/get-repository-evaluation-setting/index.ts"
import { initializeEvaluationSetting } from "../../../../repositories/evaluation-settings/initialize-evaluation-setting/index.ts"
import { saveRepositoryEvaluationSetting } from "../../../../repositories/evaluation-settings/save-repository-evaluation-setting/index.ts"
import { updateEvaluationBudget } from "../../../../repositories/evaluation-settings/update-evaluation-budget/index.ts"
import { createJobQueue } from "../../../../integrations/bullmq/create-job-queue/index.ts"
import { enqueueJob } from "../../../../integrations/bullmq/enqueue-job/index.ts"
import { LearningCommandError } from "../../../../integrations/learning/run-learning-command/errors.ts"
import { withLearningExecutionLock } from "../../../../integrations/postgres/with-learning-execution-lock/index.ts"
import { prisma } from "../../../../integrations/prisma/index.ts"
import { classifyPrismaTransactionError } from "../../../../integrations/prisma/classify-transaction-error/index.ts"
import { getCopilotConnectionState } from "../../../../repositories/copilot-connection-states/get-copilot-connection-state/index.ts"
import { getCopilotConnection } from "../../../../repositories/copilot-connections/get-copilot-connection/index.ts"
import { createLearningRun } from "../../../../repositories/learning-runs/create-learning-run/index.ts"
import { finishLearningRun } from "../../../../repositories/learning-runs/finish-learning-run/index.ts"
import { listLearningRuns } from "../../../../repositories/learning-runs/list-learning-runs/index.ts"
import { listLearningActivityDays } from "../../../../repositories/learning-activity-days/list-learning-activity-days/index.ts"
import { createLearningDecisionOperation } from "../../../../repositories/learning-decision-operations/create-learning-decision-operation/index.ts"
import { deleteLearningDecisionOperation } from "../../../../repositories/learning-decision-operations/delete-learning-decision-operation/index.ts"
import { listLearningShares } from "../../../../repositories/learning-shares/list-learning-shares/index.ts"
import { saveLearningShare } from "../../../../repositories/learning-shares/save-learning-share/index.ts"
import { withdrawLearningShare } from "../../../../repositories/learning-shares/withdraw-learning-share/index.ts"
import { lockAdministratorHubSession } from "../../../../repositories/hub-sessions/lock-administrator-hub-session/index.ts"
import { isEffectiveAdministrator } from "../../../../repositories/memberships/is-effective-administrator/index.ts"
import { findActiveRepository } from "../../../../repositories/prototype-index/find-active-repository/index.ts"
import { lockRepositoryAdministratorAuthority } from "../../../../repositories/repository-access/lock-repository-administrator-authority/index.ts"
import { lockRepositoryAdministratorSession } from "../../../../repositories/repository-access/lock-repository-administrator-session/index.ts"
import { createSecurityAudit } from "../../../../repositories/security-audits/create-security-audit/index.ts"
import { readWithPersistedRepositoryScope } from "../../product/read-with-persisted-repository-scope/index.ts"
import type { resolveRepositoryScope } from "../../product/resolve-repository-scope/index.ts"
import { LearningsError } from "../errors.ts"
import { isDefinitiveDecisionRejection } from "../is-definitive-decision-rejection/index.ts"
import { runWithBoundedRetries } from "../../../../domains/identity/run-with-bounded-retries/index.ts"
import type { CurrentSessionDependencies } from "../../auth/types.ts"
import type { LearningsRouteDependencies } from "../types.ts"

const sharedSourceConcurrency = 4
const sharedSourceTimeoutMs = 10_000

export async function createLearningsRouteDependencies(
  environment: NodeJS.ProcessEnv,
  currentSession: CurrentSessionDependencies,
  logger: Logger,
  options: { scopeGitHubMembers?: boolean; source?: ReviewCommentLearningSource } = {},
): Promise<LearningsRouteDependencies> {
  const configuration = await readLearningConfiguration(environment)
  const applicationOrigin = environment.HUB_APPLICATION_ORIGIN
  const databaseUrl = environment.DATABASE_URL
  if (!applicationOrigin || !databaseUrl) {
    throw new Error("HUB_APPLICATION_ORIGIN and DATABASE_URL are required for the Learnings API.")
  }
  const source = options.source ?? createReviewCommentLearningSource(prisma, applicationOrigin)

  async function runRepositoryAuthorityTransaction<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result> {
    try {
      return await runWithBoundedRetries(
        () => prisma.$transaction(operation),
        (error) => classifyPrismaTransactionError(error) === "retryable",
      )
    } catch (error) {
      if (classifyPrismaTransactionError(error) === "retryable") {
        throw new LearningsError(
          503,
          "repository_authority_unavailable",
          "Repository access is temporarily unavailable. Try again.",
          { cause: error },
        )
      }
      throw error
    }
  }

  function findRepository(
    viewer: Parameters<typeof resolveRepositoryScope>[0],
    repositoryId: string,
  ) {
    return readWithPersistedRepositoryScope(
      prisma,
      viewer,
      options.scopeGitHubMembers ?? false,
      (scope) => findActiveRepository(prisma, repositoryId, scope),
    )
  }

  /**
   * Reads the learnings other repositories share, straight from each source store, so a
   * learning that was retired or stopped reaching agents there stops being shared too. A
   * source Hub cannot read is skipped rather than hiding this repository's own learnings.
   */
  async function readSharedLearnings(shares: Awaited<ReturnType<typeof listLearningShares>>) {
    const sources = new Map<string, typeof shares>()
    for (const share of shares) {
      sources.set(share.repositoryId, [...(sources.get(share.repositoryId) ?? []), share])
    }
    async function readSource([sourceId, sourceShares]: [string, typeof shares]) {
      try {
        const records = await readShareableLearnings({
          ...configuration,
          learningIds: sourceShares.map((share) => share.learningId),
          repositoryId: sourceId,
          repositoryScope: await getLearningRepositoryScope(prisma, sourceId),
          timeoutMs: sharedSourceTimeoutMs,
        })
        return records.flatMap((record) => {
          const share = sourceShares.find((item) => item.learningId === record.id)
          return share
            ? [
                {
                  record,
                  source: share.repository.nameWithOwner,
                  sharedBy: share.sharedByMembership?.user.profile?.login ?? null,
                  sharedAt: share.sharedAt.toISOString(),
                },
              ]
            : []
        })
      } catch (error) {
        // Any failure stays with its source, so one broken store cannot take down the
        // Learnings page of every repository it shares with.
        logger.warn(
          {
            learningFailureCode: error instanceof LearningCommandError ? error.code : "unexpected",
            repositoryId: sourceId,
          },
          "Shared learnings could not be read",
        )
        return []
      }
    }
    // A few sources at a time, each with a short deadline, so stalled stores cannot hold
    // the page for minutes or start one process per repository at once.
    const entries = [...sources]
    const shared = []
    for (let start = 0; start < entries.length; start += sharedSourceConcurrency) {
      const batch = entries.slice(start, start + sharedSourceConcurrency)
      shared.push(...(await Promise.all(batch.map(readSource))).flat())
    }
    return shared
  }

  /**
   * Queues removal of the screenshots a withdrawn grant allowed. A failed enqueue is only
   * logged because the worker's recovery pass finds every withdrawn grant again.
   */
  async function queueScreenshotDeletion(input: {
    databaseUrl: string
    grantId: string
    repositoryId: string
  }) {
    const { grantId, repositoryId } = input
    const queue = createJobQueue({ name: "on-demand", databaseUrl: input.databaseUrl, logger })
    try {
      await enqueueJob(
        queue,
        deleteAgentScreenshotsJob,
        { repositoryId, grantId },
        { jobId: `learning-screenshots-${repositoryId}-${grantId}` },
      )
    } catch (error) {
      logger.warn(
        { errorType: error instanceof Error ? error.name : "UnknownError", repositoryId },
        "Screenshot consent was withdrawn but its screenshot removal could not be queued",
      )
    } finally {
      await queue.close()
    }
  }

  async function getCopilot() {
    const connection = await getCopilotConnection(prisma)
    const state = await getCopilotConnectionState(prisma)
    if (!state) throw new Error("The Copilot connection state is unavailable.")
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
    if (status.refusedAt) {
      return { state: "refused" as const, refusedAt: status.refusedAt.toISOString() }
    }
    return status.connected
      ? { state: "connected" as const, connectedBy: status.connectedBy?.login ?? null }
      : { state: "not-connected" as const }
  }

  return {
    applicationOrigin,
    automaticRunsEnabled: configuration.automaticRuns,
    currentSession,
    authorizeRepositoryAdministration: (input) =>
      runRepositoryAuthorityTransaction((transaction) =>
        lockRepositoryAdministratorAuthority(transaction, input),
      ),
    auditRepositoryAdministrationDenial: async ({ actorMembershipId, operation, repositoryId }) => {
      await createSecurityAudit(prisma, {
        id: randomUUID(),
        type: "repository_administration_denied",
        actorMembershipId,
        operation,
        reason: "authority_missing",
        repositoryId,
      })
    },
    findRepository,
    getOverview: async ({ repositoryId, viewer }) => {
      const repositoryScope = await getLearningRepositoryScope(prisma, repositoryId)
      const shares = await listLearningShares(prisma)
      const shared = await readSharedLearnings(
        shares.filter((share) => share.repositoryId !== repositoryId),
      )
      try {
        const overview = await getLearningOverview({
          ...configuration,
          evidenceSource: source,
          repositoryId,
          repositoryScope,
          shared,
          sharedLearningIds: shares
            .filter((share) => share.repositoryId === repositoryId)
            .map((share) => share.learningId),
          viewer,
        })
        if (repositoryScope !== (await getLearningRepositoryScope(prisma, repositoryId))) {
          throw new LearningCommandError(
            "repository_scope_unavailable",
            "The repository learning scope changed. Try again.",
          )
        }
        return overview
      } catch (error) {
        if (!(error instanceof LearningCommandError)) throw error
        if (error.code === "repository_scope_unavailable") throw error
        logger.warn(
          { learningFailureCode: error.code, repositoryId },
          "Repository learning overview failed",
        )
        return {
          loadError: "Hub could not read this repository's learning store.",
          identityReviewCount: 0,
          suggestions: [],
          learnings: [],
          rejected: [],
          shared: [],
          recall: { text: "", count: 0 },
        }
      }
    },
    getHistory: async ({ repositoryId, learningId }) => {
      const repositoryScope = await getLearningRepositoryScope(prisma, repositoryId)
      const history = await getLearningHistory({
        ...configuration,
        evidenceSource: source,
        learningId,
        repositoryId,
        repositoryScope,
      })
      if (repositoryScope !== (await getLearningRepositoryScope(prisma, repositoryId))) {
        throw new LearningCommandError(
          "repository_scope_unavailable",
          "The repository learning scope changed. Try again.",
        )
      }
      return history
    },
    getCopilot,
    listRuns: (repositoryId) => listLearningRuns(prisma, repositoryId, new Date()),
    listActivity: (repositoryId, from) => listLearningActivityDays(prisma, repositoryId, from),
    requestRun: async ({ actorMembershipId, repositoryId, requestedById, sessionDigest }) => {
      if (
        !(await runRepositoryAuthorityTransaction((transaction) =>
          lockRepositoryAdministratorSession(transaction, {
            membershipId: actorMembershipId,
            repositoryId,
            sessionDigest,
          }),
        ))
      ) {
        await createSecurityAudit(prisma, {
          id: randomUUID(),
          type: "repository_administration_denied",
          actorMembershipId,
          operation: "learning_run",
          reason: "authority_missing",
          repositoryId,
        })
        throw new LearningsError(
          403,
          "repository_administrator_required",
          "Repository administrator access is required.",
        )
      }
      await getLearningRepositoryScope(prisma, repositoryId)
      if ((await getCopilot()).state !== "connected") {
        throw new LearningsError(
          409,
          "copilot_not_connected",
          "Connect Copilot before looking for learnings.",
        )
      }
      let snapshot
      try {
        snapshot = await source.captureCompleteSnapshot({ repositoryId })
      } catch (error) {
        if (
          error instanceof LearningCommandError &&
          error.code === "repository_scope_unavailable"
        ) {
          throw error
        }
        if (error instanceof ReviewCommentError && error.code === "not_found") {
          throw new LearningsError(404, "repository_not_found", "Repository not found.", {
            cause: error,
          })
        }
        throw new LearningsError(
          409,
          "review_snapshot_unavailable",
          "Hub could not capture a complete repository review snapshot.",
          { cause: error },
        )
      }
      const requested = await runRepositoryAuthorityTransaction(async (transaction) => {
        if (
          !(await lockRepositoryAdministratorSession(transaction, {
            membershipId: actorMembershipId,
            repositoryId,
            sessionDigest,
          }))
        ) {
          await createSecurityAudit(transaction, {
            id: randomUUID(),
            type: "repository_administration_denied",
            actorMembershipId,
            operation: "learning_run",
            reason: "authority_missing",
            repositoryId,
          })
          return null
        }
        if (
          snapshot.repositoryScope !== (await getLearningRepositoryScope(transaction, repositoryId))
        ) {
          throw new LearningCommandError(
            "repository_scope_unavailable",
            "The repository learning scope changed. Try again.",
          )
        }
        const result = await createLearningRun(transaction, {
          repositoryId,
          requestedById,
          requestedByMembershipId: actorMembershipId,
          snapshotDigest: snapshot.digest,
          reviewActivitySnapshot: snapshot.reviewActivitySnapshot,
        })
        if (result.created || result.promoted) {
          await createSecurityAudit(transaction, {
            id: randomUUID(),
            type: "learning_run",
            actorMembershipId,
            outcome: "requested",
            repositoryId,
            runId: result.run.id,
          })
        }
        return result
      })
      if (!requested) {
        throw new LearningsError(
          403,
          "repository_administrator_required",
          "Repository administrator access is required.",
        )
      }
      const { run, created, promoted } = requested
      const queue = createJobQueue({ name: "on-demand", databaseUrl, logger })
      try {
        await enqueueJob(
          queue,
          learningRunJob,
          { runId: run.id },
          { jobId: `learning-run-${run.id}` },
        )
      } catch (error) {
        if (created || promoted) {
          await recordFinishedLearningRun(prisma, run.id, (transaction) =>
            finishLearningRun(transaction, run.id, {
              state: "FAILED",
              failureCode: "enqueue_failed",
              failureSummary: "Hub could not queue this learning run.",
              finishedAt: new Date(),
            }),
          )
          await createSecurityAudit(prisma, {
            id: randomUUID(),
            type: "learning_run",
            actorMembershipId,
            outcome: "failed",
            reason: "enqueue_failed",
            repositoryId,
            runId: run.id,
          })
        }
        throw new LearningsError(
          503,
          "learning_run_unavailable",
          "Hub could not queue this learning run.",
          { cause: error },
        )
      } finally {
        await queue.close()
      }
      return {
        notice:
          created || promoted ? "Learning run requested." : "Learning run already in progress.",
      }
    },
    share: async ({ actorMembershipId, learningId, repositoryId, sessionDigest, shared }) => {
      if (shared) {
        const shareable = await readShareableLearnings({
          ...configuration,
          learningIds: [learningId],
          repositoryId,
          repositoryScope: await getLearningRepositoryScope(prisma, repositoryId),
        })
        if (shareable.length === 0) {
          throw new LearningsError(
            409,
            "learning_not_shareable",
            "Only an accepted learning that agents receive can be shared.",
          )
        }
      }
      const authorized = await runRepositoryAuthorityTransaction(async (transaction) => {
        if (
          !(await lockRepositoryAdministratorSession(transaction, {
            membershipId: actorMembershipId,
            repositoryId,
            sessionDigest,
          })) ||
          !(await isEffectiveAdministrator(transaction, actorMembershipId))
        ) {
          return false
        }
        const change = { repositoryId, learningId, membershipId: actorMembershipId, at: new Date() }
        if (shared) await saveLearningShare(transaction, change)
        else await withdrawLearningShare(transaction, change)
        await createSecurityAudit(transaction, {
          id: randomUUID(),
          type: "learning_share",
          actorMembershipId,
          learningId,
          repositoryId,
          shared,
        })
        return true
      })
      if (!authorized) {
        await createSecurityAudit(prisma, {
          id: randomUUID(),
          type: "repository_administration_denied",
          actorMembershipId,
          operation: "learning_share",
          reason: "authority_missing",
          repositoryId,
        })
        throw new LearningsError(
          403,
          "repository_administrator_required",
          "Hub and repository administrator access is required.",
        )
      }
      return {
        notice: shared ? "Shared across Hub." : "Stopped sharing across Hub.",
      }
    },
    redactComment: async ({ repositoryId, commentId, actorLogin }) => {
      const queue = createJobQueue({ name: "on-demand", databaseUrl, logger })
      try {
        await enqueueJob(
          queue,
          redactReviewCommentJob,
          {
            repositoryId,
            commentId,
            actor: `human:${actorLogin}`,
          },
          { jobId: `learning-redact-${repositoryId}-${commentId}` },
        )
      } catch (error) {
        logger.warn(
          {
            errorType: error instanceof Error ? error.name : "UnknownError",
            repositoryId,
            commentId,
          },
          "Review comment was deleted but its learning redaction could not be queued",
        )
      } finally {
        await queue.close()
      }
    },
    getEvaluationSettings: async (repositoryId) => {
      const budget = await initializeEvaluationSetting(prisma)
      const setting = await getRepositoryEvaluationSetting(prisma, repositoryId)
      return {
        // toFixed keeps tiny budgets in plain digits instead of forms like 1e-9.
        monthlyBudgetCredits: budget.monthlyBudgetCredits.toFixed(),
        enabled: setting?.enabled ?? false,
        screenshots: {
          allowed: Boolean(setting?.screenshotGrantId),
          changedBy: setting?.screenshotsChangedByMembership?.user.profile?.login ?? null,
          changedAt: setting?.screenshotsChangedAt?.toISOString() ?? null,
        },
      }
    },
    changeEvaluationSettings: async ({ actorMembershipId, sessionDigest, ...input }) => {
      async function deny(): Promise<never> {
        await createSecurityAudit(prisma, {
          id: randomUUID(),
          type: "repository_administration_denied",
          actorMembershipId,
          operation: "learning_evaluation",
          reason: "authority_missing",
          repositoryId: input.repositoryId,
        })
        throw new LearningsError(
          403,
          "repository_administrator_required",
          "Repository administrator access is required.",
        )
      }
      // Each step re-locks the person's session, so losing access between steps stops
      // the change rather than finishing it on authority they no longer hold.
      function withAuthority<Result>(
        operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
      ) {
        return runRepositoryAuthorityTransaction(async (transaction) =>
          (await lockRepositoryAdministratorSession(transaction, {
            membershipId: actorMembershipId,
            repositoryId: input.repositoryId,
            sessionDigest,
          }))
            ? { value: await operation(transaction) }
            : null,
        )
      }
      try {
        // Consent lives in the learning store, so one change at a time keeps Hub's
        // record and the store's grant from drifting apart.
        await withLearningExecutionLock({
          databaseUrl,
          protectSessionAuthority: true,
          run: async (signal) => {
            const read = await withAuthority(async (transaction) => ({
              repositoryScope: await getLearningRepositoryScope(transaction, input.repositoryId),
              setting: await getRepositoryEvaluationSetting(transaction, input.repositoryId),
            }))
            if (!read) return deny()
            const { repositoryScope, setting } = read.value
            const enabled = input.enabled ?? setting?.enabled ?? false
            const grantId = setting?.screenshotGrantId ?? null
            // Screenshots only serve evaluations, so turning evaluations off withdraws
            // them too.
            const allowed = enabled && (input.screenshots ?? Boolean(grantId))
            if (input.screenshots && !enabled) {
              throw new LearningsError(
                409,
                "evaluations_disabled",
                "Turn on automated evaluations before allowing screenshots.",
              )
            }
            if (enabled !== (setting?.enabled ?? false)) {
              if (
                !(await withAuthority((transaction) =>
                  saveRepositoryEvaluationSetting(transaction, input.repositoryId, { enabled }),
                ))
              ) {
                return deny()
              }
            }
            if (allowed === Boolean(grantId)) return
            const nextGrantId = await changeScreenshotConsent({
              ...configuration,
              actor: input.actor,
              allowed,
              grantId,
              repositoryId: input.repositoryId,
              repositoryScope,
              signal,
            })
            const saved = await withAuthority((transaction) =>
              saveRepositoryEvaluationSetting(transaction, input.repositoryId, {
                screenshotGrantId: nextGrantId,
                screenshotsChangedAt: new Date(),
                screenshotsChangedByMembershipId: actorMembershipId,
              }),
            )
            if (!saved) return deny()
            if (grantId && !allowed)
              await queueScreenshotDeletion({
                databaseUrl,
                grantId,
                repositoryId: input.repositoryId,
              })
          },
        })
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Another learning operation is still running."
        ) {
          throw new LearningsError(
            409,
            "learning_execution_busy",
            "Another learning operation is still running.",
            { cause: error },
          )
        }
        throw error
      }
      return { notice: "Evaluation settings saved." }
    },
    changeEvaluationBudget: async ({ actorMembershipId, sessionDigest, monthlyBudgetCredits }) => {
      const saved = await runRepositoryAuthorityTransaction(async (transaction) => {
        // Locking the session keeps a sign-out or demotion from landing mid-save.
        const session = await lockAdministratorHubSession(transaction, sessionDigest)
        if (session?.membershipId !== actorMembershipId) return false
        await updateEvaluationBudget(transaction, monthlyBudgetCredits)
        return true
      })
      if (!saved) {
        throw new LearningsError(
          403,
          "hub_administrator_required",
          "Hub administrator access is required.",
        )
      }
      return { notice: "Budget saved." }
    },
    serializeReviewCommentDeletion: (operation) =>
      withLearningExecutionLock({
        databaseUrl,
        run: () => operation(),
      }),
    decide: async ({ actorMembershipId, sessionDigest, ...input }) => {
      const viewer: Parameters<typeof resolveRepositoryScope>[0] = {
        membershipId: actorMembershipId,
        role: "ADMINISTRATOR",
        sessionProvider: null,
      }
      const operationId = randomUUID()
      let operationCreated = false
      try {
        const result = await withLearningExecutionLock({
          databaseUrl,
          protectSessionAuthority: true,
          run: async (signal) => {
            if (!(await findRepository(viewer, input.repositoryId))) {
              throw new LearningsError(404, "repository_not_found", "Repository not found.")
            }
            const authorized = await runRepositoryAuthorityTransaction(async (transaction) => {
              if (
                !(await lockRepositoryAdministratorSession(transaction, {
                  membershipId: actorMembershipId,
                  repositoryId: input.repositoryId,
                  sessionDigest,
                }))
              ) {
                return false
              }
              const repositoryScope = await getLearningRepositoryScope(
                transaction,
                input.repositoryId,
              )
              await createLearningDecisionOperation(transaction, {
                id: operationId,
                actorMembershipId,
                decision: input.decision.decision,
                learningId: input.learningId,
                repositoryId: input.repositoryId,
              })
              await createSecurityAudit(transaction, {
                id: randomUUID(),
                type: "learning_decision",
                actorMembershipId,
                decision: input.decision.decision,
                learningId: input.learningId,
                operationId,
                outcome: "requested",
                repositoryId: input.repositoryId,
              })
              return repositoryScope
            })
            if (!authorized) {
              await createSecurityAudit(prisma, {
                id: randomUUID(),
                type: "repository_administration_denied",
                actorMembershipId,
                operation: "learning_decision",
                reason: "authority_missing",
                repositoryId: input.repositoryId,
              })
              throw new LearningsError(
                403,
                "repository_administrator_required",
                "Repository administrator access is required.",
              )
            }
            operationCreated = true
            return executeLearningDecision({
              ...configuration,
              ...input,
              repositoryScope: authorized,
              operationId,
              signal,
            })
          },
        })
        try {
          await prisma.$transaction(async (transaction) => {
            const claimed = await deleteLearningDecisionOperation(transaction, operationId)
            if (claimed.count !== 1) return
            await createSecurityAudit(transaction, {
              id: randomUUID(),
              type: "learning_decision",
              actorMembershipId,
              decision: input.decision.decision,
              learningId: input.learningId,
              operationId,
              outcome: "succeeded",
              repositoryId: input.repositoryId,
            })
          })
        } catch (error) {
          logger.error(
            {
              errorType: error instanceof Error ? error.name : "UnknownError",
              learningId: input.learningId,
              repositoryId: input.repositoryId,
            },
            "The learning decision succeeded but its security audit could not be saved",
          )
          throw error
        }
        return result
      } catch (error) {
        const definitiveRejection = operationCreated && isDefinitiveDecisionRejection(error)
        if (definitiveRejection) {
          await prisma.$transaction(async (transaction) => {
            const claimed = await deleteLearningDecisionOperation(transaction, operationId)
            if (claimed.count !== 1) return
            await createSecurityAudit(transaction, {
              id: randomUUID(),
              type: "learning_decision",
              actorMembershipId,
              decision: input.decision.decision,
              learningId: input.learningId,
              operationId,
              outcome: "failed",
              reason:
                error instanceof LearningCommandError || error instanceof LearningsError
                  ? error.code.slice(0, 100)
                  : "decision_rejected",
              repositoryId: input.repositoryId,
            })
          })
        }
        if (
          operationCreated &&
          error instanceof LearningCommandError &&
          !(await findRepository(viewer, input.repositoryId))
        ) {
          throw new LearningsError(404, "repository_not_found", "Repository not found.", {
            cause: error,
          })
        }
        if (
          !definitiveRejection &&
          error instanceof Error &&
          error.message === "Another learning operation is still running."
        ) {
          throw new LearningsError(
            409,
            "learning_execution_busy",
            "Another learning operation is still running.",
            { cause: error },
          )
        }
        throw error
      }
    },
  }
}
