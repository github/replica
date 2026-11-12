import { randomUUID } from "node:crypto"

import type { Prisma } from "../../../../generated/prisma/client.ts"
import { connectCopilot } from "../../../../domains/copilot-connection/connect-copilot/index.ts"
import { disconnectCopilot } from "../../../../domains/copilot-connection/disconnect-copilot/index.ts"
import { getCopilotConnectionStatus } from "../../../../domains/copilot-connection/get-copilot-connection-status/index.ts"
import { readCopilotConnectionSnapshot } from "../../../../domains/copilot-connection/read-copilot-connection-snapshot/index.ts"
import { recordCopilotConnectionFailure } from "../../../../domains/copilot-connection/record-copilot-connection-failure/index.ts"
import { recordCopilotConnectionRefusal } from "../../../../domains/copilot-connection/record-copilot-connection-refusal/index.ts"
import { runCopilotConnectionTransaction } from "../../../../domains/copilot-connection/run-copilot-connection-transaction/index.ts"
import { createCopilotConnectionCheckLimit } from "../../../../domains/copilot-connection/with-copilot-connection-check/index.ts"
import { readLearningConfiguration } from "../../../../domains/learning/read-learning-configuration/index.ts"
import { runLearningCommand } from "../../../../integrations/learning/run-learning-command/index.ts"
import { prisma } from "../../../../integrations/prisma/index.ts"
import { advanceCopilotConnectionState } from "../../../../repositories/copilot-connection-states/advance-copilot-connection-state/index.ts"
import { clearCopilotCredentialRefusal } from "../../../../repositories/copilot-connection-states/clear-copilot-credential-refusal/index.ts"
import { getCopilotConnectionState } from "../../../../repositories/copilot-connection-states/get-copilot-connection-state/index.ts"
import { lockCopilotConnectionState } from "../../../../repositories/copilot-connection-states/lock-copilot-connection-state/index.ts"
import { recordCopilotCredentialRefusal } from "../../../../repositories/copilot-connection-states/record-copilot-credential-refusal/index.ts"
import { deleteCopilotConnection } from "../../../../repositories/copilot-connections/delete-copilot-connection/index.ts"
import { getCopilotConnection } from "../../../../repositories/copilot-connections/get-copilot-connection/index.ts"
import { replaceCopilotConnection } from "../../../../repositories/copilot-connections/replace-copilot-connection/index.ts"
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
      clearRefusal: () => clearCopilotCredentialRefusal(transaction),
      deleteConnection: () => deleteCopilotConnection(transaction),
      findAdministratorSession: (digest) => findAdministratorHubSession(transaction, digest),
      getConnection: () => getCopilotConnection(transaction),
      lockState: () => lockCopilotConnectionState(transaction),
      replaceConnection: (input) => replaceCopilotConnection(transaction, input),
      recordRefusal: (input) => recordCopilotCredentialRefusal(transaction, input),
      writeAudit: (event) => createSecurityAudit(transaction, event),
    }
  }

  function runTransaction<T>(
    operation: (repositories: CopilotConnectionTransactionRepositories) => Promise<T>,
  ) {
    return runCopilotConnectionTransaction(prisma, transactionRepositories, operation)
  }
  const withCopilotConnectionCheck = createCopilotConnectionCheckLimit()

  return {
    applicationOrigin,
    findSession,
    connect: ({ sessionDigest, signal }) =>
      withCopilotConnectionCheck(() =>
        connectCopilot(
          {
            credentialProvider: configuration.copilotCredentialProvider,
            sessionDigest,
          },
          {
            check: async () => {
              const credential = await configuration.copilotCredentialProvider.getCredential()
              if (!credential) {
                throw new Error("The configured Copilot credential is unavailable.")
              }
              return runLearningCommand(["copilot", "status"], {
                cliPath: configuration.cliPath,
                githubToken: credential.githubToken,
                nodePath: configuration.nodePath,
                signal,
              })
            },
            createId: randomUUID,
            findAdministratorSession: findSession,
            now: () => new Date(),
            readSnapshot: () =>
              readCopilotConnectionSnapshot({
                getConnection: () => getCopilotConnection(prisma),
                getState: () => getCopilotConnectionState(prisma),
              }),
            recordFailure: (input) =>
              recordCopilotConnectionFailure(input, { createId: randomUUID, runTransaction }),
            recordRefusal: (input) =>
              recordCopilotConnectionRefusal(input, { createId: randomUUID, runTransaction }),
            runTransaction,
            writeAudit: (event) => createSecurityAudit(prisma, event),
          },
        ),
      ),
    disconnect: ({ sessionDigest }) =>
      disconnectCopilot({ sessionDigest }, { createId: randomUUID, runTransaction }),
    status: async () => {
      const connection = await getCopilotConnection(prisma)
      const state = await getCopilotConnectionState(prisma)
      if (!state) throw new Error("The Copilot connection state is unavailable.")
      const connectedByIsAdministrator = connection
        ? await isEffectiveAdministrator(prisma, connection.connectedByMembershipId)
        : false
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
        connectedByIsAdministrator,
        {
          credentialDigest: state.refusedCredentialDigest,
          credentialProvider: state.refusedCredentialProvider,
          refusedAt: state.refusedAt,
        },
      )
    },
  }
}
