import { randomUUID } from "node:crypto"
import type { Logger } from "pino"

import { getCopilotConnectionStatus } from "../../../../domains/copilot-connection/get-copilot-connection-status/index.ts"
import { executeLearningDecision } from "../../../../domains/learning/execute-learning-decision/index.ts"
import { getLearningOverview } from "../../../../domains/learning/get-learning-overview/index.ts"
import type { ReviewCommentLearningSource } from "../../../../domains/learning/review-comment-learning-source/types.ts"
import { readLearningConfiguration } from "../../../../domains/learning/read-learning-configuration/index.ts"
import { LearningCommandError } from "../../../../integrations/learning/run-learning-command/errors.ts"
import { withLearningExecutionLock } from "../../../../integrations/postgres/with-learning-execution-lock/index.ts"
import { prisma } from "../../../../integrations/prisma/index.ts"
import { getCopilotConnectionState } from "../../../../repositories/copilot-connection-states/get-copilot-connection-state/index.ts"
import { getCopilotConnection } from "../../../../repositories/copilot-connections/get-copilot-connection/index.ts"
import { listLearningRuns } from "../../../../repositories/learning-runs/list-learning-runs/index.ts"
import { isEffectiveAdministrator } from "../../../../repositories/memberships/is-effective-administrator/index.ts"
import { createSecurityAudit } from "../../../../repositories/security-audits/create-security-audit/index.ts"
import { LearningsError } from "../errors.ts"
import type { CurrentSessionDependencies } from "../../auth/types.ts"
import type { LearningsRouteDependencies } from "../types.ts"

export async function createLearningsRouteDependencies(
  environment: NodeJS.ProcessEnv,
  currentSession: CurrentSessionDependencies,
  logger: Logger,
  options: { evidenceSource?: Pick<ReviewCommentLearningSource, "resolveEvidence"> } = {},
): Promise<LearningsRouteDependencies> {
  const configuration = await readLearningConfiguration(environment)
  const applicationOrigin = environment.HUB_APPLICATION_ORIGIN
  const databaseUrl = environment.DATABASE_URL
  if (!applicationOrigin || !databaseUrl) {
    throw new Error("HUB_APPLICATION_ORIGIN and DATABASE_URL are required for the Learnings API.")
  }

  return {
    applicationOrigin,
    currentSession,
    findRepository: (repositoryId) =>
      prisma.repository.findFirst({
        where: { id: repositoryId, removedAt: null },
        select: { id: true, nameWithOwner: true, defaultBranch: true },
      }),
    getOverview: async ({ repositoryId, viewer }) => {
      try {
        return await getLearningOverview({
          ...configuration,
          evidenceSource: options.evidenceSource,
          repositoryId,
          viewer,
        })
      } catch (error) {
        if (!(error instanceof LearningCommandError)) throw error
        logger.warn(
          { learningFailureCode: error.code, repositoryId },
          "Repository learning overview failed",
        )
        return {
          loadError: "Hub could not read this repository's learning store.",
          identityReviewCount: 0,
          suggestions: [],
          learnings: [],
          recall: { text: "", count: 0 },
        }
      }
    },
    getCopilot: async () => {
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
    },
    listRuns: (repositoryId) => listLearningRuns(prisma, repositoryId, new Date()),
    decide: async ({ actorMembershipId, ...input }) => {
      try {
        const result = await withLearningExecutionLock({
          databaseUrl,
          run: (signal) =>
            executeLearningDecision({
              ...configuration,
              ...input,
              signal,
            }),
        })
        try {
          await createSecurityAudit(prisma, {
            id: randomUUID(),
            type: "learning_decision",
            actorMembershipId,
            decision: input.decision.decision,
            learningId: input.learningId,
            outcome: "succeeded",
            repositoryId: input.repositoryId,
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
        if (error instanceof LearningCommandError || error instanceof LearningsError) {
          await createSecurityAudit(prisma, {
            id: randomUUID(),
            type: "learning_decision",
            actorMembershipId,
            decision: input.decision.decision,
            learningId: input.learningId,
            outcome: "failed",
            reason: error instanceof LearningCommandError ? error.code.slice(0, 100) : error.code,
            repositoryId: input.repositoryId,
          })
          throw error
        }
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
    },
  }
}
