import { resolveDecisionRuntime } from "../resolve-decision-runtime/index.ts"
import type { DecisionModelDependencies } from "../types.ts"

export async function reconcileDecisionRuntimeDeletion(
  deletionId: string,
  dependencies: DecisionModelDependencies,
) {
  const deletion = await dependencies.store.getDeletion?.(deletionId)
  if (!deletion || deletion.state !== "PENDING" || !deletion.runtimeDeletionId) return
  const runtime = resolveDecisionRuntime(dependencies, deletion.repositoryId)
  if (!runtime.getDeletion || !dependencies.store.updateDeletionReceipt) {
    throw new Error("Decision runtime deletion support is required.")
  }
  const receipt = await runtime.getDeletion(deletion.runtimeDeletionId)
  await dependencies.store.updateDeletionReceipt(deletion.id, receipt)
}
