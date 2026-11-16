import { Prisma } from "../../../../generated/prisma/client.ts"
import { restoreHubSession } from "../../../../domains/admission/restore-hub-session/index.ts"
import { runSessionRestoreTransaction } from "../../../../domains/admission/run-session-restore-transaction/index.ts"
import { editPrototypeMetadata } from "../../../../domains/prototypes/edit-prototype-metadata/index.ts"
import { readPrototypeWithIntroduction } from "../../../../domains/prototypes/read-prototype-with-introduction/index.ts"
import { prisma } from "../../../../integrations/prisma/index.ts"
import { lockAuthenticationProvidersForPrototypeEdit } from "../../../../repositories/authentication-providers/lock-authentication-providers-for-prototype-edit/index.ts"
import { findRepositoryAuthors } from "../../../../repositories/prototype-index/find-repository-authors/index.ts"
import { findRepositoryIndex } from "../../../../repositories/prototype-index/find-repository-index/index.ts"
import { findPrototypeDetail } from "../../../../repositories/prototype-index/find-prototype-detail/index.ts"
import { listRepositories } from "../../../../repositories/prototype-index/list-repositories/index.ts"
import { recordPrototypeIntroduction } from "../../../../repositories/prototype-introductions/record-prototype-introduction/index.ts"
import { lockEditablePrototype } from "../../../../repositories/prototypes/lock-editable-prototype/index.ts"
import { lockVisiblePrototype } from "../../../../repositories/prototypes/lock-visible-prototype/index.ts"
import { updatePrototypeMetadata } from "../../../../repositories/prototypes/update-prototype-metadata/index.ts"
import { lockSessionRevocationState } from "../../../../repositories/session-revocation-states/lock-session-revocation-state/index.ts"
import type { ProductRouteDependencies } from "../types.ts"

export function createProductRouteDependencies(): ProductRouteDependencies {
  return {
    listRepositories: () => listRepositories(prisma),
    findRepositoryIndex: (repositoryId, filters) =>
      findRepositoryIndex(prisma, repositoryId, filters),
    findPrototypeDetail: (repositoryId, prototypeId, buildNumber) =>
      findPrototypeDetail(prisma, repositoryId, prototypeId, buildNumber),
    readPrototypeWithIntroduction: (input, prepare) =>
      readPrototypeWithIntroduction(input, {
        prepare,
        runTransaction: (operation) =>
          prisma.$transaction(
            async (transaction) => {
              await lockAuthenticationProvidersForPrototypeEdit(transaction)
              await lockSessionRevocationState(transaction)
              const joined = {
                $transaction: <Result>(
                  read: (client: Prisma.TransactionClient) => Promise<Result>,
                ) => read(transaction),
                repository: transaction.repository,
              }
              return operation({
                restoreSession: (digest) =>
                  restoreHubSession(digest, {
                    runTransaction: (restore) => runSessionRestoreTransaction(joined, restore),
                  }),
                lockPrototype: (repositoryId, prototypeId) =>
                  lockVisiblePrototype(transaction, repositoryId, prototypeId),
                findDetail: (repositoryId, prototypeId, buildNumber) =>
                  findPrototypeDetail(joined, repositoryId, prototypeId, buildNumber),
                recordIntroduction: (userId, prototypeId) =>
                  recordPrototypeIntroduction(transaction, userId, prototypeId),
              })
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
          ),
      }),
    findRepositoryAuthors: (repositoryId, filters) =>
      findRepositoryAuthors(prisma, repositoryId, filters),
    editPrototypeMetadata: (input) =>
      editPrototypeMetadata(input, {
        runTransaction: (operation) =>
          prisma.$transaction(
            async (transaction) => {
              await lockAuthenticationProvidersForPrototypeEdit(transaction)
              await lockSessionRevocationState(transaction)
              // Keep these reads in this transaction so authority and prototype locks remain
              // held through the read-back.
              const joined = {
                $transaction: <Result>(
                  read: (client: Prisma.TransactionClient) => Promise<Result>,
                ) => read(transaction),
                repository: transaction.repository,
              }
              return operation({
                restoreSession: (digest) =>
                  restoreHubSession(digest, {
                    runTransaction: (restore) => runSessionRestoreTransaction(joined, restore),
                  }),
                lockPrototype: (repositoryId, prototypeId) =>
                  lockEditablePrototype(transaction, repositoryId, prototypeId),
                updatePrototype: (id, data) => updatePrototypeMetadata(transaction, id, data),
                findDetail: (repositoryId, prototypeId) =>
                  findPrototypeDetail(joined, repositoryId, prototypeId),
              })
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
          ),
      }),
  }
}
