import { createHash, randomUUID } from "node:crypto"

import type { Prisma } from "../../../../generated/prisma/client.ts"
import { connectCopilot } from "../../../../domains/copilot-connection/connect-copilot/index.ts"
import { disconnectCopilot } from "../../../../domains/copilot-connection/disconnect-copilot/index.ts"
import { readLearningConfiguration } from "../../../../domains/learning/read-learning-configuration/index.ts"
import { runLearningCommand } from "../../../../integrations/learning/run-learning-command/index.ts"
import { prisma } from "../../../../integrations/prisma/index.ts"
import { advanceCopilotConnectionState } from "../../../../repositories/copilot-connection-states/advance-copilot-connection-state/index.ts"
import { lockCopilotConnectionState } from "../../../../repositories/copilot-connection-states/lock-copilot-connection-state/index.ts"
import { deleteCopilotConnection } from "../../../../repositories/copilot-connections/delete-copilot-connection/index.ts"
import { getCopilotConnection } from "../../../../repositories/copilot-connections/get-copilot-connection/index.ts"
import { replaceCopilotConnection } from "../../../../repositories/copilot-connections/replace-copilot-connection/index.ts"
import { refuseCopilotConnection } from "../../../../repositories/copilot-connections/refuse-copilot-connection/index.ts"
import { findAdministratorHubSession } from "../../../../repositories/hub-sessions/find-administrator-hub-session/index.ts"
import { isEffectiveAdministrator } from "../../../../repositories/memberships/is-effective-administrator/index.ts"
import { createSecurityAudit } from "../../../../repositories/security-audits/create-security-audit/index.ts"
import type { CopilotConnectionTransactionRepositories } from "../../../../domains/copilot-connection/types.ts"
import type { CopilotConnectionRouteDependencies } from "../types.ts"

export async function createCopilotConnectionRouteDependencies(
  environment: NodeJS.ProcessEnv,
): Promise<CopilotConnectionRouteDependencies> {
  const configuration = await readLearningConfiguration(environment)
  const applicationOrigin = environment.HUB_APPLICATION_ORIGIN
  if (!applicationOrigin) {
    throw new Error("HUB_APPLICATION_ORIGIN is required for the Copilot connection API.")
  }

  function findSession(sessionDigest: string) {
    return findAdministratorHubSession(prisma, sessionDigest)
  }

  function transactionRepositories(
    transaction: Prisma.TransactionClient,
  ): CopilotConnectionTransactionRepositories {
    return {
      advanceState: () => advanceCopilotConnectionState(transaction),
      deleteConnection: () => deleteCopilotConnection(transaction),
      findAdministratorSession: (digest) => findAdministratorHubSession(transaction, digest),
      getConnection: () => getCopilotConnection(transaction),
      lockState: () => lockCopilotConnectionState(transaction),
      replaceConnection: (input) => replaceCopilotConnection(transaction, input),
      writeAudit: (event) => createSecurityAudit(transaction, event),
    }
  }

  function runTransaction<T>(
    operation: (repositories: CopilotConnectionTransactionRepositories) => Promise<T>,
  ) {
    return prisma.$transaction((transaction) => operation(transactionRepositories(transaction)), {
      isolationLevel: "Serializable",
    })
  }

  return {
    applicationOrigin,
    findSession,
    connect: ({ sessionDigest }) =>
      connectCopilot(
        { sessionDigest, token: configuration.copilotToken },
        {
          check: (token) =>
            runLearningCommand(["copilot", "status"], {
              cliPath: configuration.cliPath,
              copilotToken: token,
              nodePath: configuration.nodePath,
            }),
          createId: randomUUID,
          findAdministratorSession: findSession,
          now: () => new Date(),
          readSnapshot: () =>
            prisma.$transaction(async (transaction) => {
              const state = await transaction.copilotConnectionState.findUnique({
                where: { key: "global" },
              })
              if (!state) throw new Error("The Copilot connection state is unavailable.")
              const connection = await getCopilotConnection(transaction)
              return { connectionId: connection?.id ?? null, generation: state.generation }
            }),
          recordRefusal: (input) =>
            prisma.$transaction(async (transaction) => {
              const state = await lockCopilotConnectionState(transaction)
              const connection = await getCopilotConnection(transaction)
              if (
                !state ||
                state.generation !== input.snapshot.generation ||
                connection?.id !== input.snapshot.connectionId
              ) {
                return
              }
              if (connection) {
                await refuseCopilotConnection(transaction, {
                  id: connection.id,
                  refusedAt: input.at,
                  tokenDigest: input.tokenDigest,
                })
              }
              await createSecurityAudit(transaction, {
                actorMembershipId: input.actorMembershipId,
                connectionId: connection?.id,
                id: randomUUID(),
                phase: "denied",
                reason: "token_refused",
                type: "copilot_connection",
              })
            }),
          runTransaction,
          writeAudit: (event) => createSecurityAudit(prisma, event),
        },
      ),
    disconnect: ({ sessionDigest }) =>
      disconnectCopilot({ sessionDigest }, { createId: randomUUID, runTransaction }),
    status: async () => {
      const connection = await getCopilotConnection(prisma)
      const tokenDigest = configuration.copilotToken
        ? createHash("sha256").update(configuration.copilotToken).digest("hex")
        : null
      const connectedByIsAdministrator = connection
        ? await isEffectiveAdministrator(prisma, connection.connectedByMembershipId)
        : false
      const refused =
        connection?.refusedAt !== null &&
        connection?.refusedAt !== undefined &&
        tokenDigest === connection.tokenDigest
      const connected = Boolean(connection && tokenDigest && connectedByIsAdministrator && !refused)
      return {
        configured: tokenDigest !== null,
        connected,
        connectedBy:
          connection && connectedByIsAdministrator
            ? {
                login: connection.connectedByMembership.user.profile?.login ?? null,
                membershipId: connection.connectedByMembershipId,
                name: connection.connectedByMembership.user.profile?.name ?? null,
              }
            : null,
        refusedAt: refused ? (connection?.refusedAt ?? null) : null,
        verifiedAt: connection?.verifiedAt ?? null,
      }
    },
  }
}
