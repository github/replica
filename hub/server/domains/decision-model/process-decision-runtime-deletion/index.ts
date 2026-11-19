import { resolveDecisionRuntime } from "../resolve-decision-runtime/index.ts"
import type { DecisionModelDependencies } from "../types.ts"
import type { DecisionRuntimeDeletionSelectors } from "../../../integrations/decision-runtime/create-decision-runtime-client/types.ts"

export async function processDecisionRuntimeDeletion(
  input: {
    repositoryId: string
    actorMembershipId: string
    actorLogin: string
    selectors: DecisionRuntimeDeletionSelectors
    reason: string
    idempotencyKey: string
    authorizationAlreadyEstablished?: boolean
  },
  dependencies: DecisionModelDependencies,
) {
  if (!input.authorizationAlreadyEstablished) {
    await dependencies.authorization.requireRepositoryAdministrator({
      membershipId: input.actorMembershipId,
      repositoryId: input.repositoryId,
    })
  }
  if (!dependencies.store.createOrGetDeletion) {
    throw new Error("Decision runtime deletion support is required.")
  }
  const deletion = await dependencies.store.createOrGetDeletion({
    repositoryId: input.repositoryId,
    requestedByMembershipId: input.actorMembershipId,
    idempotencyKey: input.idempotencyKey,
    selectors: input.selectors,
    reason: input.reason,
  })
  const runtime = resolveDecisionRuntime(dependencies, input.repositoryId)
  if (
    !runtime.listRuntimeCopies ||
    !runtime.requestDeletion ||
    !runtime.getDeletion ||
    !dependencies.store.saveRuntimeCopies ||
    !dependencies.store.updateDeletionReceipt
  ) {
    throw new Error("Decision runtime deletion support is required.")
  }
  let cursor: string | undefined
  do {
    const page = await runtime.listRuntimeCopies({
      selectors: input.selectors,
      cursor,
      limit: 50,
    })
    await dependencies.store.saveRuntimeCopies(input.repositoryId, page.items)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  const receipt = deletion.runtimeDeletionId
    ? await runtime.getDeletion(deletion.runtimeDeletionId)
    : await runtime.requestDeletion({
        selectors: input.selectors,
        requestedBy: input.actorLogin,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      })
  await dependencies.store.updateDeletionReceipt(deletion.id, receipt)
  return {
    id: deletion.id,
    state: receipt.state,
    pending: receipt.pendingItems.length,
    failures: receipt.failures.length,
    completedAt: receipt.completedAt ?? null,
  }
}
